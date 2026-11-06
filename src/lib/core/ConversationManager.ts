import type { ConversationDriver } from '../drivers/ConversationDriver.js';
import {
  type Conversation,
  type CreateConversationPayload,
  type Message,
  type PostMessagePayload,
  type ThreadTreeNode,
  type ThreadTreeOptions
} from '../types.js';
import { ThreadTree } from './ThreadTree.js';
import { ConversationTranscript, type TranscriptOptions } from './transcript.js';
import { extractMentionIdsFromHtml } from './mentionTokens.js';
import { buildMessageEdit } from './messageEdits.js';
import { normalizeReactionInput, type ReactionInput } from './reactions.js';
import {
  createMessageStickerTools,
  extractMessageStickers,
  resolveMessageStickers,
  resolveSticker,
  type MessageStickerAgentTool,
  type ResolvedSticker,
  type ResolveStickerOptions,
  type StickerProviderInput
} from './stickers.js';

export interface ConversationManagerOptions {
  driver: ConversationDriver;
  /**
   * Optional sticker provider (or array of providers) for inline message stickers and sticker reactions.
   */
  stickerProvider?: StickerProviderInput;
  /**
   * Optional hook invoked whenever a message is posted (e.g. for notifications fan-out).
   */
  onMessagePosted?: (message: Message, conversation: Conversation) => void | Promise<void>;
}

export class ConversationManager {
  private driver: ConversationDriver;
  private stickerProvider?: StickerProviderInput;
  private onMessagePosted?: (message: Message, conversation: Conversation) => void | Promise<void>;

  constructor(options: ConversationManagerOptions) {
    if (!options?.driver) {
      throw new Error('ConversationManager requires a storage driver.');
    }
    this.driver = options.driver;
    this.stickerProvider = options.stickerProvider;
    this.onMessagePosted = options.onMessagePosted;
  }

  public getStickerProvider(): StickerProviderInput | undefined {
    return this.stickerProvider;
  }

  public setStickerProvider(provider: StickerProviderInput | undefined): void {
    this.stickerProvider = provider;
  }

  public async getConversation(id: string): Promise<Conversation | null> {
    return this.driver.getConversation(id);
  }

  public async getConversationByEntity(
    entityId: string,
    entityType?: string
  ): Promise<Conversation | null> {
    return this.driver.getConversationByEntity(entityId, entityType);
  }

  public async getOrCreateConversation(
    payload: CreateConversationPayload
  ): Promise<{ conversation: Conversation; created: boolean }> {
    const existing = await this.driver.getConversationByEntity(
      payload.entity.id,
      payload.entity.type
    );
    if (existing) {
      return { conversation: existing, created: false };
    }
    const created = await this.driver.createConversation(payload);
    return { conversation: created, created: true };
  }

  public async createConversation(payload: CreateConversationPayload): Promise<Conversation> {
    return this.driver.createConversation(payload);
  }

  public async resolveConversation(
    conversationId: string,
    resolvedBy?: string
  ): Promise<Conversation> {
    return this.driver.updateConversationStatus(conversationId, 'resolved', resolvedBy);
  }

  public async reopenConversation(conversationId: string): Promise<Conversation> {
    return this.driver.updateConversationStatus(conversationId, 'open');
  }

  public async archiveConversation(conversationId: string): Promise<Conversation> {
    return this.driver.updateConversationStatus(conversationId, 'archived');
  }

  public async postMessage(payload: PostMessagePayload): Promise<Message> {
    // If richContent contains HTML mention nodes, automatically harvest explicit mention IDs
    let mentions = payload.mentions ? [...payload.mentions] : [];
    if (payload.richContent) {
      const extractedIds = extractMentionIdsFromHtml(payload.richContent);
      for (const id of extractedIds) {
        if (!mentions.includes(id)) {
          mentions.push(id);
        }
      }
    }

    // Automatically harvest inline sticker shortcodes / HTML tokens
    let stickers = payload.stickers ? [...payload.stickers] : [];
    for (const stickerId of extractMessageStickers(payload.content, payload.richContent)) {
      if (!stickers.includes(stickerId)) {
        stickers.push(stickerId);
      }
    }

    const message = await this.driver.postMessage({
      ...payload,
      mentions,
      ...(stickers.length > 0 ? { stickers } : {})
    });

    if (this.onMessagePosted) {
      try {
        const convo = await this.driver.getConversation(payload.conversationId);
        if (convo) {
          await this.onMessagePosted(message, convo);
        }
      } catch (err) {
        console.error('[ConversationManager] onMessagePosted error:', err);
      }
    }

    return message;
  }

  /**
   * Posts a message with optimistic staging and automatic rollback on failure.
   */
  public async postMessageOptimistic(
    payload: PostMessagePayload,
    callbacks: {
      onOptimistic: (optimisticMessage: Message) => void;
      onRollback?: (error: Error, tempId: string) => void;
      onSuccess?: (confirmedMessage: Message) => void;
    }
  ): Promise<Message> {
    const tempId =
      payload.id || `temp_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    let mentions = payload.mentions ? [...payload.mentions] : [];
    if (payload.richContent) {
      const extractedIds = extractMentionIdsFromHtml(payload.richContent);
      for (const id of extractedIds) {
        if (!mentions.includes(id)) {
          mentions.push(id);
        }
      }
    }

    let stickers = payload.stickers ? [...payload.stickers] : [];
    for (const stickerId of extractMessageStickers(payload.content, payload.richContent)) {
      if (!stickers.includes(stickerId)) {
        stickers.push(stickerId);
      }
    }

    const optimisticMessage: Message = {
      id: tempId,
      conversationId: payload.conversationId,
      author: payload.author,
      content: payload.content,
      richContent: payload.richContent,
      parentId: payload.parentId || null,
      status: 'pending',
      mentions,
      ...(stickers.length > 0 ? { stickers } : {}),
      attachments: payload.attachments || [],
      reactions: payload.reactions || [],
      metadata: payload.metadata || {},
      createdAt: now
    };

    callbacks.onOptimistic(optimisticMessage);

    try {
      const confirmed = await this.postMessage({
        ...payload,
        id: payload.id
      });
      callbacks.onSuccess?.(confirmed);
      return confirmed;
    } catch (err: any) {
      callbacks.onRollback?.(err, tempId);
      throw err;
    }
  }

  public async editMessage(
    messageId: string,
    content: string,
    options?: { richContent?: string; conversationId?: string }
  ): Promise<Message> {
    return this.driver.updateMessage(
      messageId,
      buildMessageEdit(content, options?.richContent),
      options?.conversationId
    );
  }

  public async deleteMessage(messageId: string, conversationId?: string): Promise<Message> {
    return this.driver.deleteMessage(messageId, conversationId);
  }

  public async addReaction(
    messageId: string,
    emojiOrReaction: ReactionInput,
    userId: string,
    conversationId?: string
  ): Promise<Message> {
    const normalized = normalizeReactionInput(emojiOrReaction, this.stickerProvider);
    return this.driver.addReaction(messageId, { ...normalized, userId }, conversationId);
  }

  public async removeReaction(
    messageId: string,
    emojiOrReaction: ReactionInput,
    userId: string,
    conversationId?: string
  ): Promise<Message> {
    const normalized = normalizeReactionInput(emojiOrReaction, this.stickerProvider);
    return this.driver.removeReaction(messageId, normalized.emoji, userId, conversationId);
  }

  public async toggleReaction(
    messageId: string,
    emojiOrReaction: ReactionInput,
    userId: string,
    conversationId?: string
  ): Promise<Message> {
    const normalized = normalizeReactionInput(emojiOrReaction, this.stickerProvider);
    return this.driver.toggleReaction(messageId, { ...normalized, userId }, conversationId);
  }

  public async addStickerReaction(
    messageId: string,
    sticker: string,
    userId: string,
    conversationId?: string
  ): Promise<Message> {
    return this.addReaction(messageId, { sticker }, userId, conversationId);
  }

  public async removeStickerReaction(
    messageId: string,
    sticker: string,
    userId: string,
    conversationId?: string
  ): Promise<Message> {
    return this.removeReaction(messageId, { sticker }, userId, conversationId);
  }

  public async toggleStickerReaction(
    messageId: string,
    sticker: string,
    userId: string,
    conversationId?: string
  ): Promise<Message> {
    return this.toggleReaction(messageId, { sticker }, userId, conversationId);
  }

  public async resolveSticker(
    tokenOrRef: string,
    options?: ResolveStickerOptions
  ): Promise<ResolvedSticker | undefined> {
    if (!this.stickerProvider) return undefined;
    return resolveSticker(this.stickerProvider, tokenOrRef, options);
  }

  public async resolveMessageStickers(
    message: Pick<Message, 'content' | 'richContent' | 'stickers' | 'reactions'>,
    options?: ResolveStickerOptions
  ): Promise<Map<string, ResolvedSticker>> {
    if (!this.stickerProvider) return new Map();
    return resolveMessageStickers(this.stickerProvider, message, options);
  }

  public createStickerTools(): MessageStickerAgentTool[] {
    return createMessageStickerTools({
      provider: () => {
        if (!this.stickerProvider) {
          throw new Error('No stickerProvider configured on ConversationManager.');
        }
        return this.stickerProvider;
      }
    });
  }

  public async listMessages(conversationId: string): Promise<Message[]> {
    return this.driver.listMessages(conversationId);
  }

  public async getThreadTree(
    conversationId: string,
    options: ThreadTreeOptions = {}
  ): Promise<ThreadTreeNode[]> {
    const messages = await this.driver.listMessages(conversationId);
    return ThreadTree.buildTree(messages, options);
  }

  public async exportTranscript(
    conversationId: string,
    options: TranscriptOptions = {}
  ): Promise<string> {
    const convo = await this.driver.getConversation(conversationId);
    if (!convo) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    const messages = await this.driver.listMessages(conversationId);
    return ConversationTranscript.formatAsMarkdown(convo, messages, options);
  }

  public subscribeToConversation(
    conversationId: string,
    onUpdate: (
      conversation: Conversation | null,
      messages: Message[],
      tree: ThreadTreeNode[]
    ) => void,
    onError?: (error: Error) => void
  ): () => void {
    return this.driver.subscribeToConversation(
      conversationId,
      (convo, msgs) => {
        const tree = ThreadTree.buildTree(msgs);
        onUpdate(convo, msgs, tree);
      },
      onError
    );
  }

  public subscribeToEntityConversations(
    entityId: string,
    onUpdate: (conversations: Conversation[]) => void,
    onError?: (error: Error) => void
  ): () => void {
    return this.driver.subscribeToEntityConversations(entityId, onUpdate, onError);
  }
}
