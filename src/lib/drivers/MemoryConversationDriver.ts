import type { ConversationDriver } from './ConversationDriver.js';
import type {
  Conversation,
  CreateConversationPayload,
  Message,
  PostMessagePayload,
  TextAnchor
} from '../types.js';
import { hasUserReacted, normalizeReactionInput, type ReactionInput } from '../core/reactions.js';

type Listener = (conversation: Conversation | null, messages: Message[]) => void;
type EntityListener = (conversations: Conversation[]) => void;
type EntitySubscription = { callback: EntityListener; entityType?: string };

export class MemoryConversationDriver implements ConversationDriver {
  private conversations = new Map<string, Conversation>();
  private messages = new Map<string, Message[]>(); // Key: conversationId
  private listeners = new Map<string, Set<Listener>>();
  private entityListeners = new Map<string, Set<EntitySubscription>>();

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

  public async listConversationsByEntity(
    entityId: string,
    entityType?: string
  ): Promise<Conversation[]> {
    const matches: Conversation[] = [];
    for (const convo of this.conversations.values()) {
      if (convo.entity.id === entityId && (!entityType || convo.entity.type === entityType)) {
        matches.push(convo);
      }
    }
    return matches.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  public async createConversation(payload: CreateConversationPayload): Promise<Conversation> {
    const id = payload.id || `convo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const conversation: Conversation = {
      id,
      entity: payload.entity,
      ...(payload.anchor ? { anchor: payload.anchor } : {}),
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
    this.notifyEntity(conversation.entity.id);

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
    this.notifyEntity(updated.entity.id);

    return updated;
  }

  public async updateConversationAnchor(
    id: string,
    anchor: TextAnchor | null
  ): Promise<Conversation> {
    const convo = this.conversations.get(id);
    if (!convo) {
      throw new Error(`Conversation not found: ${id}`);
    }

    const now = new Date().toISOString();
    const { anchor: _removed, ...rest } = convo;
    const updated: Conversation = {
      ...rest,
      ...(anchor !== null ? { anchor } : {}),
      updatedAt: now
    };

    this.conversations.set(id, updated);
    this.notify(id);
    this.notifyEntity(updated.entity.id);

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
      ...(payload.stickers ? { stickers: payload.stickers } : {}),
      attachments: payload.attachments || [],
      reactions: payload.reactions || [],
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

  public async updateMessage(
    id: string,
    updates: Partial<Message>,
    conversationId?: string
  ): Promise<Message> {
    const targetConvoIds = conversationId ? [conversationId] : Array.from(this.messages.keys());

    for (const convoId of targetConvoIds) {
      const list = this.messages.get(convoId);
      if (!list) continue;
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

  public async deleteMessage(id: string, conversationId?: string): Promise<Message> {
    return this.updateMessage(
      id,
      {
        status: 'deleted',
        content: '[This comment was deleted]',
        richContent: undefined,
        attachments: []
      },
      conversationId
    );
  }

  public async addReaction(
    messageId: string,
    reaction: { emoji: string; sticker?: string; userId: string },
    conversationId?: string
  ): Promise<Message> {
    const targetConvoIds = conversationId ? [conversationId] : Array.from(this.messages.keys());
    const normalized = normalizeReactionInput(reaction);

    for (const convoId of targetConvoIds) {
      const list = this.messages.get(convoId);
      if (!list) continue;
      const msg = list.find(m => m.id === messageId);
      if (msg) {
        const currentReactions = msg.reactions || [];
        if (hasUserReacted(currentReactions, normalized, reaction.userId)) {
          return msg;
        }
        const updatedReactions = [
          ...currentReactions,
          {
            emoji: normalized.emoji,
            ...(normalized.sticker ? { sticker: normalized.sticker } : {}),
            userId: reaction.userId,
            createdAt: new Date().toISOString()
          }
        ];
        return this.updateMessage(messageId, { reactions: updatedReactions }, convoId);
      }
    }
    throw new Error(`Message not found: ${messageId}`);
  }

  public async removeReaction(
    messageId: string,
    reaction: ReactionInput,
    userId: string,
    conversationId?: string
  ): Promise<Message> {
    const targetConvoIds = conversationId ? [conversationId] : Array.from(this.messages.keys());

    for (const convoId of targetConvoIds) {
      const list = this.messages.get(convoId);
      if (!list) continue;
      const msg = list.find(m => m.id === messageId);
      if (msg) {
        const currentReactions = msg.reactions || [];
        const target = normalizeReactionInput(reaction);
        const updatedReactions = currentReactions.filter(
          r => !hasUserReacted([r], target, userId)
        );
        return this.updateMessage(messageId, { reactions: updatedReactions }, convoId);
      }
    }
    throw new Error(`Message not found: ${messageId}`);
  }

  public async toggleReaction(
    messageId: string,
    reaction: { emoji: string; sticker?: string; userId: string },
    conversationId?: string
  ): Promise<Message> {
    const targetConvoIds = conversationId ? [conversationId] : Array.from(this.messages.keys());
    const normalized = normalizeReactionInput(reaction);

    for (const convoId of targetConvoIds) {
      const msg = this.messages.get(convoId)?.find(m => m.id === messageId);
      if (msg) {
        return hasUserReacted(msg.reactions, normalized, reaction.userId)
          ? this.removeReaction(messageId, normalized, reaction.userId, convoId)
          : this.addReaction(messageId, { ...normalized, userId: reaction.userId }, convoId);
      }
    }
    throw new Error(`Message not found: ${messageId}`);
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

  public subscribeToEntityConversations(
    entityId: string,
    onUpdate: EntityListener,
    _onError?: (error: Error) => void,
    entityType?: string
  ): () => void {
    let set = this.entityListeners.get(entityId);
    if (!set) {
      set = new Set();
      this.entityListeners.set(entityId, set);
    }
    const sub: EntitySubscription = { callback: onUpdate, entityType };
    set.add(sub);

    // Send immediate initial list
    const currentMatches = Array.from(this.conversations.values()).filter(
      c => c.entity.id === entityId && (!entityType || c.entity.type === entityType)
    );
    onUpdate(currentMatches);

    return () => {
      const currentSet = this.entityListeners.get(entityId);
      if (currentSet) {
        currentSet.delete(sub);
        if (currentSet.size === 0) {
          this.entityListeners.delete(entityId);
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

  private notifyEntity(entityId: string): void {
    const set = this.entityListeners.get(entityId);
    if (!set || set.size === 0) return;

    const matches = Array.from(this.conversations.values()).filter(c => c.entity.id === entityId);
    for (const sub of set) {
      try {
        const filtered = sub.entityType
          ? matches.filter(c => c.entity.type === sub.entityType)
          : matches;
        sub.callback(filtered);
      } catch (err) {
        console.error('[MemoryConversationDriver] EntityListener error:', err);
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
    this.entityListeners.clear();
  }
}
