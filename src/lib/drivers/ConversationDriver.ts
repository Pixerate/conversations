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
  updateMessage(id: string, updates: Partial<Message>): Promise<Message>;

  /**
   * Subscribes to real-time changes on a conversation document and its messages.
   * Returns an unsubscribe function.
   */
  subscribeToConversation(
    conversationId: string,
    onUpdate: (conversation: Conversation | null, messages: Message[]) => void,
    onError?: (error: Error) => void
  ): () => void;
}
