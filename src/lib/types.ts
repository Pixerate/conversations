import { z } from 'zod';
import { NotificationActorSchema, type NotificationActor } from '@pixerate/schemas';

export { NotificationActorSchema, type NotificationActor };

export const EntityRefSchema = z.object({
  id: z.string(),
  type: z.string().default('task'),
  title: z.string().optional(),
  projectId: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});
export type EntityRef = z.infer<typeof EntityRefSchema>;

export const TextQuoteSelectorSchema = z.object({
  exact: z.string(),
  prefix: z.string().optional(),
  suffix: z.string().optional()
});
export type TextQuoteSelector = z.infer<typeof TextQuoteSelectorSchema>;

export const TextAnchorStateSchema = z.enum(['attached', 'orphaned']);
export type TextAnchorState = z.infer<typeof TextAnchorStateSchema>;

export const TextAnchorSchema = z
  .object({
    /** Inclusive start offset in UTF-16 code units (matches JS string indices and Apple NSRange). */
    start: z.number().int().nonnegative(),
    /** Exclusive end offset in UTF-16 code units. */
    end: z.number().int().nonnegative(),
    quote: TextQuoteSelectorSchema,
    state: TextAnchorStateSchema.default('attached')
  })
  .refine(anchor => anchor.end >= anchor.start, {
    message: 'TextAnchor end offset must be greater than or equal to start offset',
    path: ['end']
  });
export type TextAnchor = z.infer<typeof TextAnchorSchema>;
export const DocumentAnchorSchema = TextAnchorSchema;
export type DocumentAnchor = TextAnchor;

export const MessageStatusSchema = z.enum(['sent', 'pending', 'failed', 'deleted']);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const MessageReactionSchema = z.object({
  emoji: z.string(),
  sticker: z.string().optional(),
  userId: z.string(),
  createdAt: z.string().optional()
});
export type MessageReaction = z.infer<typeof MessageReactionSchema>;

export interface GroupedReaction {
  emoji: string;
  sticker?: string;
  count: number;
  hasReacted: boolean;
  users: string[];
  userNames: string[];
  tooltip: string;
}

export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  author: NotificationActorSchema,
  content: z.string(),
  richContent: z.string().optional(),
  parentId: z.string().nullable().optional(),
  status: MessageStatusSchema.default('sent'),
  mentions: z.array(z.string()).default([]),
  stickers: z.array(z.string()).optional(),
  attachments: z.array(z.record(z.unknown())).default([]),
  reactions: z.array(MessageReactionSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional()
});
export type Message = z.infer<typeof MessageSchema>;

export type PostMessagePayload = {
  id?: string;
  conversationId: string;
  author: NotificationActor;
  content: string;
  richContent?: string;
  parentId?: string | null;
  status?: MessageStatus;
  mentions?: string[];
  stickers?: string[];
  attachments?: Record<string, unknown>[];
  reactions?: MessageReaction[];
  metadata?: Record<string, unknown>;
};

export const ConversationStatusSchema = z.enum(['open', 'resolved', 'archived']);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  entity: EntityRefSchema,
  anchor: TextAnchorSchema.optional(),
  status: ConversationStatusSchema.default('open'),
  participantIds: z.array(z.string()).default([]),
  messageCount: z.number().nonnegative().default(0),
  lastMessageAt: z.string().optional(),
  resolvedAt: z.string().optional(),
  resolvedBy: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Conversation = z.infer<typeof ConversationSchema>;

export type CreateConversationPayload = {
  id?: string;
  entity: EntityRef;
  anchor?: TextAnchor;
  metadata?: Record<string, unknown>;
};

export interface ThreadTreeNode {
  message: Message;
  depth: number;
  children: ThreadTreeNode[];
  isSyntheticParent?: boolean;
}

export interface ThreadTreeOptions {
  /**
   * How to handle child messages whose parentId does not exist in the message set.
   * - 'placeholder': creates a synthetic parent node marked `isSyntheticParent: true` with placeholder content.
   * - 'root': promotes the orphan message to the root level.
   * Defaults to 'placeholder'.
   */
  orphanStrategy?: 'placeholder' | 'root';
}
