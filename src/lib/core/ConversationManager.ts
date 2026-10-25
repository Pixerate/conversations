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
    onUpdate: (conversation: Conversation | null, messages: Message[], tree: ThreadTreeNode[]) => void,
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
}
