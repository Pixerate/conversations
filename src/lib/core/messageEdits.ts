import type { Message } from '../types.js';
import { extractMentionIdsFromHtml } from './mentionTokens.js';
import { extractMessageStickers } from './stickers.js';

/**
 * Builds the partial update for editing a message's content.
 * Leaves `richContent` untouched when no new rich content is supplied, and re-harvests
 * mention IDs and inline sticker tokens so edits never wipe formatting or leave stale metadata.
 */
export function buildMessageEdit(content: string, richContent?: string): Partial<Message> {
  const updates: Partial<Message> = { content };
  if (richContent !== undefined) {
    updates.richContent = richContent;
    updates.mentions = extractMentionIdsFromHtml(richContent);
  }
  const stickers = extractMessageStickers(content, richContent);
  if (stickers.length > 0) {
    updates.stickers = stickers;
  }
  return updates;
}
