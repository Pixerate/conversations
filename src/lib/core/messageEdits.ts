import type { Message } from '../types.js';
import { extractMentionIdsFromHtml } from './mentionTokens.js';

/**
 * Builds the partial update for editing a message's content.
 * Leaves `richContent` untouched when no new rich content is supplied, and re-harvests
 * mention IDs whenever it is, so edits never wipe formatting or leave stale mentions.
 */
export function buildMessageEdit(content: string, richContent?: string): Partial<Message> {
  const updates: Partial<Message> = { content };
  if (richContent !== undefined) {
    updates.richContent = richContent;
    updates.mentions = extractMentionIdsFromHtml(richContent);
  }
  return updates;
}
