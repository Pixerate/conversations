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

export const MessageStatusSchema = z.enum(['sent', 'pending', 'failed', 'deleted']);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  author: NotificationActorSchema,
  content: z.string(),
  richContent: z.string().optional(),
  parentId: z.string().nullable().optional(),
  status: MessageStatusSchema.default('sent'),
  mentions: z.array(z.string()).default([]),
  attachments: z.array(z.record(z.unknown())).default([]),
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
  mentions?: string[];
  attachments?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
};

export const ConversationStatusSchema = z.enum(['open', 'resolved', 'archived']);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  entity: EntityRefSchema,
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
