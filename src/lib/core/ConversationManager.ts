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

export interface ConversationManagerOptions {
  driver: ConversationDriver;
  /**
   * Optional hook invoked whenever a message is posted (e.g. for notifications fan-out).
   */
  onMessagePosted?: (message: Message, conversation: Conversation) => void | Promise<void>;
}

export class ConversationManager {
  private driver: ConversationDriver;
  private onMessagePosted?: (message: Message, conversation: Conversation) => void | Promise<void>;

  constructor(options: ConversationManagerOptions) {
    if (!options?.driver) {
      throw new Error('ConversationManager requires a storage driver.');
    }
    this.driver = options.driver;
    this.onMessagePosted = options.onMessagePosted;
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

    const message = await this.driver.postMessage({
      ...payload,
      mentions
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

    const optimisticMessage: Message = {
      id: tempId,
      conversationId: payload.conversationId,
      author: payload.author,
      content: payload.content,
      richContent: payload.richContent,
      parentId: payload.parentId || null,
      status: 'pending',
      mentions,
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
    emoji: string,
    userId: string,
    conversationId?: string
  ): Promise<Message> {
    return this.driver.addReaction(messageId, { emoji, userId }, conversationId);
  }

  public async removeReaction(
    messageId: string,
    emoji: string,
    userId: string,
    conversationId?: string
  ): Promise<Message> {
    return this.driver.removeReaction(messageId, emoji, userId, conversationId);
  }

  public async toggleReaction(
    messageId: string,
    emoji: string,
    userId: string,
    conversationId?: string
  ): Promise<Message> {
    return this.driver.toggleReaction(messageId, { emoji, userId }, conversationId);
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
