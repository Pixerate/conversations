import { useSyncExternalStore, useMemo, useCallback } from 'react';
import type { ConversationDriver } from '../drivers/ConversationDriver.js';
import type { Conversation, Message, ThreadTreeNode, GroupedReaction } from '../types.js';
import { ThreadTree } from '../core/ThreadTree.js';
import { reconcileOptimisticMessages, reconcileAndMergeMessages } from '../core/reconciliation.js';
import { groupReactions, normalizeReactionInput, type ReactionInput } from '../core/reactions.js';
import { buildMessageEdit } from '../core/messageEdits.js';
import {
  extractMessageStickers,
  resolveMessageStickers,
  resolveSticker,
  type ResolvedSticker,
  type ResolveStickerOptions,
  type StickerProviderInput
} from '../core/stickers.js';

export interface UseThreadOptions {
  stickerProvider?: StickerProviderInput;
}

function unwrapStickerProvider(
  options?: UseThreadOptions | StickerProviderInput
): StickerProviderInput | undefined {
  if (!options) return undefined;
  if (Array.isArray(options) || typeof (options as any).load === 'function') {
    return options as StickerProviderInput;
  }
  return (options as UseThreadOptions).stickerProvider;
}

export interface ThreadState {
  conversation: Conversation | null;
  messages: Message[];
  tree: ThreadTreeNode[];
  loading: boolean;
  error: Error | null;
}

class ThreadStoreSubscriber {
  private driver: ConversationDriver;
  private conversationId: string;
  private state: ThreadState;
  private serverMessages: Message[] = [];
  private optimisticMessages: Message[] = [];
  private listeners = new Set<() => void>();
  private unsubscribeDriver?: () => void;

  constructor(driver: ConversationDriver, conversationId: string) {
    this.driver = driver;
    this.conversationId = conversationId;
    this.state = {
      conversation: null,
      messages: [],
      tree: [],
      loading: true,
      error: null
    };
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    if (this.listeners.size === 1) {
      // Re-register if this subscriber was evicted while idle but is still held by a component
      const threads = threadsFor(this.driver);
      if (!threads.has(this.conversationId)) {
        threads.set(this.conversationId, this);
      }
      this.unsubscribeDriver = this.driver.subscribeToConversation(
        this.conversationId,
        (convo, msgs) => {
          this.serverMessages = msgs;
          this.optimisticMessages = reconcileOptimisticMessages(this.optimisticMessages, msgs);
          const merged = reconcileAndMergeMessages(this.optimisticMessages, this.serverMessages);

          this.state = {
            conversation: convo,
            messages: merged,
            tree: ThreadTree.buildTree(merged),
            loading: false,
            error: null
          };
          this.notify();
        },
        (err) => {
          this.state = {
            ...this.state,
            loading: false,
            error: err
          };
          this.notify();
        }
      );
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.unsubscribeDriver?.();
        this.unsubscribeDriver = undefined;
        const threads = threadsFor(this.driver);
        if (threads.get(this.conversationId) === this) {
          threads.delete(this.conversationId);
        }
      }
    };
  };

  public getSnapshot = (): ThreadState => {
    return this.state;
  };

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public postMessage = async (
    content: string,
    author: any,
    parentId?: string | null,
    richContent?: string
  ): Promise<Message> => {
    const tempId = `temp_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const stickers = extractMessageStickers(content, richContent);
    const optimisticMsg: Message = {
      id: tempId,
      conversationId: this.conversationId,
      author,
      content,
      richContent,
      parentId: parentId || null,
      status: 'pending',
      mentions: [],
      ...(stickers.length > 0 ? { stickers } : {}),
      attachments: [],
      reactions: [],
      createdAt: new Date().toISOString()
    };

    this.optimisticMessages = [...this.optimisticMessages, optimisticMsg];
    const merged = reconcileAndMergeMessages(this.optimisticMessages, this.serverMessages);
    this.state = {
      ...this.state,
      messages: merged,
      tree: ThreadTree.buildTree(merged)
    };
    this.notify();

    try {
      const confirmed = await this.driver.postMessage({
        conversationId: this.conversationId,
        author,
        content,
        richContent,
        parentId,
        ...(stickers.length > 0 ? { stickers } : {})
      });
      return confirmed;
    } catch (err: any) {
      this.optimisticMessages = this.optimisticMessages.filter(m => m.id !== tempId);
      const reverted = reconcileAndMergeMessages(this.optimisticMessages, this.serverMessages);
      this.state = {
        ...this.state,
        messages: reverted,
        tree: ThreadTree.buildTree(reverted),
        error: err
      };
      this.notify();
      throw err;
    }
  };

  public editMessage = async (messageId: string, content: string, richContent?: string) => {
    return this.driver.updateMessage(
      messageId,
      buildMessageEdit(content, richContent),
      this.conversationId
    );
  };

  public deleteMessage = async (messageId: string) => {
    return this.driver.deleteMessage(messageId, this.conversationId);
  };

  public addReaction = async (
    messageId: string,
    emojiOrReaction: ReactionInput,
    userId: string,
    provider?: StickerProviderInput
  ) => {
    const normalized = normalizeReactionInput(emojiOrReaction, provider);
    return this.driver.addReaction(messageId, { ...normalized, userId }, this.conversationId);
  };

  public removeReaction = async (
    messageId: string,
    emojiOrReaction: ReactionInput,
    userId: string,
    provider?: StickerProviderInput
  ) => {
    const normalized = normalizeReactionInput(emojiOrReaction, provider);
    return this.driver.removeReaction(messageId, normalized.emoji, userId, this.conversationId);
  };

  public toggleReaction = async (
    messageId: string,
    emojiOrReaction: ReactionInput,
    userId: string,
    provider?: StickerProviderInput
  ) => {
    const normalized = normalizeReactionInput(emojiOrReaction, provider);
    return this.driver.toggleReaction(messageId, { ...normalized, userId }, this.conversationId);
  };

  public resolve = async (resolvedBy?: string) => {
    return this.driver.updateConversationStatus(this.conversationId, 'resolved', resolvedBy);
  };

  public reopen = async () => {
    return this.driver.updateConversationStatus(this.conversationId, 'open');
  };
}

/**
 * Shared subscribers per driver, then per conversation, so components viewing the same
 * thread share one listener and optimistic state. Entries are evicted once their last
 * component unsubscribes, and a driver's whole map goes when the driver is collected.
 */
const subscriberCache = new WeakMap<ConversationDriver, Map<string, ThreadStoreSubscriber>>();

function threadsFor(driver: ConversationDriver): Map<string, ThreadStoreSubscriber> {
  let threads = subscriberCache.get(driver);
  if (!threads) {
    threads = new Map();
    subscriberCache.set(driver, threads);
  }
  return threads;
}

/**
 * React 19 hook for reactive, flicker-free conversation thread synchronization.
 */
export function useThread(
  driver: ConversationDriver,
  conversationId: string,
  options?: UseThreadOptions | StickerProviderInput
) {
  const stickerProvider = unwrapStickerProvider(options);

  const subscriber = useMemo(() => {
    const threads = threadsFor(driver);
    let sub = threads.get(conversationId);
    if (!sub) {
      sub = new ThreadStoreSubscriber(driver, conversationId);
      threads.set(conversationId, sub);
    }
    return sub;
  }, [driver, conversationId]);

  const state = useSyncExternalStore(
    subscriber.subscribe,
    subscriber.getSnapshot,
    subscriber.getSnapshot
  );

  const postMessage = useCallback(
    (content: string, author: any, parentId?: string | null, richContent?: string) => {
      return subscriber.postMessage(content, author, parentId, richContent);
    },
    [subscriber]
  );

  const editMessage = useCallback(
    (messageId: string, content: string, richContent?: string) => {
      return subscriber.editMessage(messageId, content, richContent);
    },
    [subscriber]
  );

  const deleteMessage = useCallback(
    (messageId: string) => {
      return subscriber.deleteMessage(messageId);
    },
    [subscriber]
  );

  const addReaction = useCallback(
    (messageId: string, emojiOrReaction: ReactionInput, userId: string) => {
      return subscriber.addReaction(messageId, emojiOrReaction, userId, stickerProvider);
    },
    [subscriber, stickerProvider]
  );

  const removeReaction = useCallback(
    (messageId: string, emojiOrReaction: ReactionInput, userId: string) => {
      return subscriber.removeReaction(messageId, emojiOrReaction, userId, stickerProvider);
    },
    [subscriber, stickerProvider]
  );

  const toggleReaction = useCallback(
    (messageId: string, emojiOrReaction: ReactionInput, userId: string) => {
      return subscriber.toggleReaction(messageId, emojiOrReaction, userId, stickerProvider);
    },
    [subscriber, stickerProvider]
  );

  const addStickerReaction = useCallback(
    (messageId: string, sticker: string, userId: string) => {
      return subscriber.addReaction(messageId, { sticker }, userId, stickerProvider);
    },
    [subscriber, stickerProvider]
  );

  const removeStickerReaction = useCallback(
    (messageId: string, sticker: string, userId: string) => {
      return subscriber.removeReaction(messageId, { sticker }, userId, stickerProvider);
    },
    [subscriber, stickerProvider]
  );

  const toggleStickerReaction = useCallback(
    (messageId: string, sticker: string, userId: string) => {
      return subscriber.toggleReaction(messageId, { sticker }, userId, stickerProvider);
    },
    [subscriber, stickerProvider]
  );

  const resolveStickerForThread = useCallback(
    async (
      tokenOrRef: string,
      resolveOptions?: ResolveStickerOptions
    ): Promise<ResolvedSticker | undefined> => {
      if (!stickerProvider) return undefined;
      return resolveSticker(stickerProvider, tokenOrRef, resolveOptions);
    },
    [stickerProvider]
  );

  const resolveMessageStickersForThread = useCallback(
    async (
      messageOrId: string | Pick<Message, 'content' | 'richContent' | 'stickers' | 'reactions'>,
      resolveOptions?: ResolveStickerOptions
    ): Promise<Map<string, ResolvedSticker>> => {
      if (!stickerProvider) return new Map();
      const msg =
        typeof messageOrId === 'string'
          ? state.messages.find(m => m.id === messageOrId)
          : messageOrId;
      if (!msg) return new Map();
      return resolveMessageStickers(stickerProvider, msg, resolveOptions);
    },
    [stickerProvider, state.messages]
  );

  const getGroupedReactions = useCallback(
    (messageId: string, currentUserId?: string, nameResolver?: (userId: string) => string): GroupedReaction[] => {
      const msg = state.messages.find(m => m.id === messageId);
      return groupReactions(msg?.reactions || [], currentUserId, nameResolver);
    },
    [state.messages]
  );

  const resolve = useCallback(
    (resolvedBy?: string) => {
      return subscriber.resolve(resolvedBy);
    },
    [subscriber]
  );

  const reopen = useCallback(() => {
    return subscriber.reopen();
  }, [subscriber]);

  return {
    ...state,
    stickerProvider,
    totalCount: state.messages.length,
    isResolved: state.conversation?.status === 'resolved',
    postMessage,
    editMessage,
    deleteMessage,
    addReaction,
    removeReaction,
    toggleReaction,
    addStickerReaction,
    removeStickerReaction,
    toggleStickerReaction,
    resolveSticker: resolveStickerForThread,
    resolveMessageStickers: resolveMessageStickersForThread,
    getGroupedReactions,
    resolve,
    reopen
  };
}
