import type {
  Conversation,
  CreateConversationPayload,
  Message,
  PostMessagePayload
} from '../types.js';

export interface ConversationDriver {
  /**
   * Retrieves an existing conversation by ID.
   */
  getConversation(id: string): Promise<Conversation | null>;

  /**
   * Retrieves an active conversation linked to an entity, if one exists.
   */
  getConversationByEntity(entityId: string, entityType?: string): Promise<Conversation | null>;

  /**
   * Creates a new conversation.
   */
  createConversation(payload: CreateConversationPayload): Promise<Conversation>;

  /**
   * Updates conversation status (e.g. resolve or reopen).
   */
  updateConversationStatus(
    id: string,
    status: 'open' | 'resolved' | 'archived',
    resolvedBy?: string
  ): Promise<Conversation>;

  /**
   * Posts a new message to a conversation.
   */
  postMessage(payload: PostMessagePayload): Promise<Message>;

  /**
   * Fetches all messages for a conversation, ordered chronologically.
   */
  listMessages(conversationId: string): Promise<Message[]>;

  /**
   * Updates a message (content, status, etc.).
   */
  updateMessage(id: string, updates: Partial<Message>, conversationId?: string): Promise<Message>;

  /**
   * Soft deletes a message, preserving tree structure.
   */
  deleteMessage(id: string, conversationId?: string): Promise<Message>;

  /**
   * Adds an emoji or sticker reaction to a message.
   */
  addReaction(
    messageId: string,
    reaction: { emoji: string; sticker?: string; userId: string },
    conversationId?: string
  ): Promise<Message>;

  /**
   * Removes an emoji or sticker reaction from a message.
   */
  removeReaction(
    messageId: string,
    emoji: string,
    userId: string,
    conversationId?: string
  ): Promise<Message>;

  /**
   * Adds the reaction if the user has not reacted with that emoji/sticker yet, otherwise removes it.
   * The check and the write happen atomically against the stored message.
   */
  toggleReaction(
    messageId: string,
    reaction: { emoji: string; sticker?: string; userId: string },
    conversationId?: string
  ): Promise<Message>;

  /**
   * Subscribes to real-time changes on a conversation document and its messages.
   * Returns an unsubscribe function.
   */
  subscribeToConversation(
    conversationId: string,
    onUpdate: (conversation: Conversation | null, messages: Message[]) => void,
    onError?: (error: Error) => void
  ): () => void;

  /**
   * Subscribes to real-time changes across all conversations linked to an entity.
   * Returns an unsubscribe function.
   */
  subscribeToEntityConversations(
    entityId: string,
    onUpdate: (conversations: Conversation[]) => void,
    onError?: (error: Error) => void
  ): () => void;
}
