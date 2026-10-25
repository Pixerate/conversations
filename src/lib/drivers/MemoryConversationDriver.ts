import type { ConversationDriver } from './ConversationDriver.js';
import type {
  Conversation,
  CreateConversationPayload,
  Message,
  PostMessagePayload
} from '../types.js';

type Listener = (conversation: Conversation | null, messages: Message[]) => void;

export class MemoryConversationDriver implements ConversationDriver {
  private conversations = new Map<string, Conversation>();
  private messages = new Map<string, Message[]>(); // Key: conversationId
  private listeners = new Map<string, Set<Listener>>();

  public async getConversation(id: string): Promise<Conversation | null> {
    return this.conversations.get(id) || null;
  }

  public async getConversationByEntity(
    entityId: string,
    entityType?: string
  ): Promise<Conversation | null> {
    for (const convo of this.conversations.values()) {
      if (convo.entity.id === entityId) {
        if (!entityType || convo.entity.type === entityType) {
          return convo;
        }
      }
    }
    return null;
  }

  public async createConversation(payload: CreateConversationPayload): Promise<Conversation> {
    const id = payload.id || `convo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const conversation: Conversation = {
      id,
      entity: payload.entity,
      status: 'open',
      participantIds: [],
      messageCount: 0,
      metadata: payload.metadata || {},
      createdAt: now,
      updatedAt: now
    };

    this.conversations.set(id, conversation);
    this.messages.set(id, []);
    this.notify(id);

    return conversation;
  }

  public async updateConversationStatus(
    id: string,
    status: 'open' | 'resolved' | 'archived',
    resolvedBy?: string
  ): Promise<Conversation> {
    const convo = this.conversations.get(id);
    if (!convo) {
      throw new Error(`Conversation not found: ${id}`);
    }

    const now = new Date().toISOString();
    const updated: Conversation = {
      ...convo,
      status,
      resolvedAt: status === 'resolved' ? now : undefined,
      resolvedBy: status === 'resolved' ? resolvedBy : undefined,
      updatedAt: now
    };

    this.conversations.set(id, updated);
    this.notify(id);

    return updated;
  }

  public async postMessage(payload: PostMessagePayload): Promise<Message> {
    const convo = this.conversations.get(payload.conversationId);
    if (!convo) {
      throw new Error(`Conversation not found: ${payload.conversationId}`);
    }

    const id = payload.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const message: Message = {
      id,
      conversationId: payload.conversationId,
      author: payload.author,
      content: payload.content,
      richContent: payload.richContent,
      parentId: payload.parentId || null,
      status: 'sent',
      mentions: payload.mentions || [],
      attachments: payload.attachments || [],
      metadata: payload.metadata || {},
      createdAt: now
    };

    const list = this.messages.get(payload.conversationId) || [];
    list.push(message);
    this.messages.set(payload.conversationId, list);

    // Update conversation metadata
    const participants = new Set(convo.participantIds);
    if (payload.author.id) participants.add(payload.author.id);

    const updatedConvo: Conversation = {
      ...convo,
      participantIds: Array.from(participants),
      messageCount: list.length,
      lastMessageAt: now,
      updatedAt: now
    };
    this.conversations.set(payload.conversationId, updatedConvo);

    this.notify(payload.conversationId);

    return message;
  }

  public async listMessages(conversationId: string): Promise<Message[]> {
    const list = this.messages.get(conversationId) || [];
    return [...list];
  }

  public async updateMessage(id: string, updates: Partial<Message>): Promise<Message> {
    for (const [convoId, list] of this.messages.entries()) {
      const idx = list.findIndex(m => m.id === id);
      if (idx !== -1) {
        const updated: Message = {
          ...list[idx],
          ...updates,
          updatedAt: new Date().toISOString()
        };
        list[idx] = updated;
        this.notify(convoId);
        return updated;
      }
    }
    throw new Error(`Message not found: ${id}`);
  }

  public subscribeToConversation(
    conversationId: string,
    onUpdate: Listener,
    _onError?: (error: Error) => void
  ): () => void {
    let set = this.listeners.get(conversationId);
    if (!set) {
      set = new Set();
      this.listeners.set(conversationId, set);
    }
    set.add(onUpdate);

    // Send immediate initial state
    const convo = this.conversations.get(conversationId) || null;
    const msgs = this.messages.get(conversationId) || [];
    onUpdate(convo, [...msgs]);

    return () => {
      const currentSet = this.listeners.get(conversationId);
      if (currentSet) {
        currentSet.delete(onUpdate);
        if (currentSet.size === 0) {
          this.listeners.delete(conversationId);
        }
      }
    };
  }

  private notify(conversationId: string): void {
    const set = this.listeners.get(conversationId);
    if (!set || set.size === 0) return;

    const convo = this.conversations.get(conversationId) || null;
    const msgs = this.messages.get(conversationId) || [];

    for (const listener of set) {
      try {
        listener(convo, [...msgs]);
      } catch (err) {
        console.error('[MemoryConversationDriver] Listener error:', err);
      }
    }
  }

  /**
   * Clears all in-memory data (useful for test resets).
   */
  public clear(): void {
    this.conversations.clear();
    this.messages.clear();
    this.listeners.clear();
  }
}
