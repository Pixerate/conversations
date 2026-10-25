import { useSyncExternalStore, useMemo, useCallback } from 'react';
import type { ConversationDriver } from '../drivers/ConversationDriver.js';
import type { Conversation, Message, ThreadTreeNode, GroupedReaction } from '../types.js';
import { ThreadTree } from '../core/ThreadTree.js';
import { reconcileOptimisticMessages, reconcileAndMergeMessages } from '../core/reconciliation.js';
import { groupReactions } from '../core/reactions.js';

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
      if (this.listeners.size === 0 && this.unsubscribeDriver) {
        this.unsubscribeDriver();
        this.unsubscribeDriver = undefined;
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
    const optimisticMsg: Message = {
      id: tempId,
      conversationId: this.conversationId,
      author,
      content,
      richContent,
      parentId: parentId || null,
      status: 'pending',
      mentions: [],
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
        parentId
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
      { content, richContent },
      this.conversationId
    );
  };

  public deleteMessage = async (messageId: string) => {
    return this.driver.deleteMessage(messageId, this.conversationId);
  };

  public addReaction = async (messageId: string, emoji: string, userId: string) => {
    return this.driver.addReaction(messageId, { emoji, userId }, this.conversationId);
  };

  public removeReaction = async (messageId: string, emoji: string, userId: string) => {
    return this.driver.removeReaction(messageId, emoji, userId, this.conversationId);
  };

  public toggleReaction = async (messageId: string, emoji: string, userId: string) => {
    const msg = this.state.messages.find(m => m.id === messageId);
    const hasReacted = msg?.reactions?.some(r => r.emoji === emoji && r.userId === userId);
    if (hasReacted) {
      return this.removeReaction(messageId, emoji, userId);
    }
    return this.addReaction(messageId, emoji, userId);
  };

  public resolve = async (resolvedBy?: string) => {
    return this.driver.updateConversationStatus(this.conversationId, 'resolved', resolvedBy);
  };

  public reopen = async () => {
    return this.driver.updateConversationStatus(this.conversationId, 'open');
  };
}

const subscriberCache = new Map<string, ThreadStoreSubscriber>();

/**
 * React 19 hook for reactive, flicker-free conversation thread synchronization.
 */
export function useThread(driver: ConversationDriver, conversationId: string) {
  const cacheKey = `${conversationId}`;

  const subscriber = useMemo(() => {
    let sub = subscriberCache.get(cacheKey);
    if (!sub) {
      sub = new ThreadStoreSubscriber(driver, conversationId);
      subscriberCache.set(cacheKey, sub);
    }
    return sub;
  }, [driver, conversationId, cacheKey]);

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
    (messageId: string, emoji: string, userId: string) => {
      return subscriber.addReaction(messageId, emoji, userId);
    },
    [subscriber]
  );

  const removeReaction = useCallback(
    (messageId: string, emoji: string, userId: string) => {
      return subscriber.removeReaction(messageId, emoji, userId);
    },
    [subscriber]
  );

  const toggleReaction = useCallback(
    (messageId: string, emoji: string, userId: string) => {
      return subscriber.toggleReaction(messageId, emoji, userId);
    },
    [subscriber]
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
    totalCount: state.messages.length,
    isResolved: state.conversation?.status === 'resolved',
    postMessage,
    editMessage,
    deleteMessage,
    addReaction,
    removeReaction,
    toggleReaction,
    getGroupedReactions,
    resolve,
    reopen
  };
}
