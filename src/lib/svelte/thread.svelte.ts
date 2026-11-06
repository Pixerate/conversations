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

export interface ThreadStoreOptions {
  stickerProvider?: StickerProviderInput;
}

function unwrapStickerProvider(
  options?: ThreadStoreOptions | StickerProviderInput
): StickerProviderInput | undefined {
  if (!options) return undefined;
  if (Array.isArray(options) || typeof (options as any).load === 'function') {
    return options as StickerProviderInput;
  }
  return (options as ThreadStoreOptions).stickerProvider;
}

export class ThreadStore {
  private driver: ConversationDriver;
  private conversationId: string;
  private unsubscribe?: () => void;

  public conversation = $state<Conversation | null>(null);
  public serverMessages = $state<Message[]>([]);
  public optimisticMessages = $state<Message[]>([]);
  public stickerProvider = $state<StickerProviderInput | undefined>(undefined);
  public loading = $state<boolean>(true);
  public error = $state<Error | null>(null);

  public messages = $derived<Message[]>(
    reconcileAndMergeMessages(this.optimisticMessages, this.serverMessages)
  );
  public tree = $derived<ThreadTreeNode[]>(ThreadTree.buildTree(this.messages));
  public totalCount = $derived<number>(this.messages.length);
  public isResolved = $derived<boolean>(this.conversation?.status === 'resolved');

  constructor(
    driver: ConversationDriver,
    conversationId: string,
    options?: ThreadStoreOptions | StickerProviderInput
  ) {
    this.driver = driver;
    this.conversationId = conversationId;
    this.stickerProvider = unwrapStickerProvider(options);
    this.init();
  }

  public setStickerProvider(provider: StickerProviderInput | undefined) {
    this.stickerProvider = provider;
  }

  private init() {
    this.loading = true;
    this.unsubscribe = this.driver.subscribeToConversation(
      this.conversationId,
      (convo, msgs) => {
        this.conversation = convo;
        this.serverMessages = msgs;
        this.optimisticMessages = reconcileOptimisticMessages(this.optimisticMessages, msgs);
        this.loading = false;
        this.error = null;
      },
      (err) => {
        this.error = err;
        this.loading = false;
      }
    );
  }

  public async postReply(
    content: string,
    author: any,
    parentId?: string | null,
    richContent?: string
  ): Promise<Message> {
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
      this.error = err;
      throw err;
    }
  }

  public async editMessage(messageId: string, content: string, richContent?: string) {
    return this.driver.updateMessage(
      messageId,
      buildMessageEdit(content, richContent),
      this.conversationId
    );
  }

  public async deleteMessage(messageId: string) {
    return this.driver.deleteMessage(messageId, this.conversationId);
  }

  public async addReaction(messageId: string, emojiOrReaction: ReactionInput, userId: string) {
    const normalized = normalizeReactionInput(emojiOrReaction, this.stickerProvider);
    return this.driver.addReaction(messageId, { ...normalized, userId }, this.conversationId);
  }

  public async removeReaction(messageId: string, emojiOrReaction: ReactionInput, userId: string) {
    const normalized = normalizeReactionInput(emojiOrReaction, this.stickerProvider);
    return this.driver.removeReaction(messageId, normalized.emoji, userId, this.conversationId);
  }

  public async toggleReaction(messageId: string, emojiOrReaction: ReactionInput, userId: string) {
    const normalized = normalizeReactionInput(emojiOrReaction, this.stickerProvider);
    return this.driver.toggleReaction(messageId, { ...normalized, userId }, this.conversationId);
  }

  public async addStickerReaction(messageId: string, sticker: string, userId: string) {
    return this.addReaction(messageId, { sticker }, userId);
  }

  public async removeStickerReaction(messageId: string, sticker: string, userId: string) {
    return this.removeReaction(messageId, { sticker }, userId);
  }

  public async toggleStickerReaction(messageId: string, sticker: string, userId: string) {
    return this.toggleReaction(messageId, { sticker }, userId);
  }

  public async resolveSticker(
    tokenOrRef: string,
    options?: ResolveStickerOptions
  ): Promise<ResolvedSticker | undefined> {
    if (!this.stickerProvider) return undefined;
    return resolveSticker(this.stickerProvider, tokenOrRef, options);
  }

  public async resolveMessageStickers(
    messageOrId: string | Pick<Message, 'content' | 'richContent' | 'stickers' | 'reactions'>,
    options?: ResolveStickerOptions
  ): Promise<Map<string, ResolvedSticker>> {
    if (!this.stickerProvider) return new Map();
    const msg =
      typeof messageOrId === 'string'
        ? this.messages.find(m => m.id === messageOrId)
        : messageOrId;
    if (!msg) return new Map();
    return resolveMessageStickers(this.stickerProvider, msg, options);
  }

  public getGroupedReactions(
    messageId: string,
    currentUserId?: string,
    nameResolver?: (userId: string) => string
  ): GroupedReaction[] {
    const msg = this.messages.find(m => m.id === messageId);
    return groupReactions(msg?.reactions || [], currentUserId, nameResolver);
  }

  public async resolve(resolvedBy?: string) {
    return this.driver.updateConversationStatus(this.conversationId, 'resolved', resolvedBy);
  }

  public async reopen() {
    return this.driver.updateConversationStatus(this.conversationId, 'open');
  }

  public destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }
}

/**
 * Creates a reactive Svelte 5 store for a conversation thread.
 */
export function createThreadStore(
  driver: ConversationDriver,
  conversationId: string,
  options?: ThreadStoreOptions | StickerProviderInput
): ThreadStore {
  return new ThreadStore(driver, conversationId, options);
}
