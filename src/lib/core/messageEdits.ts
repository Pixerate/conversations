import type { Message } from '../types.js';
import { extractMentionIdsFromHtml } from './mentionTokens.js';
import { extractMessageStickers, mergeMessageStickers } from './stickers.js';

export type MessageEditSource = Pick<Message, 'content' | 'richContent' | 'stickers'>;

/**
 * Builds the partial update for editing a message's content.
 * Leaves `richContent` untouched when no new rich content is supplied, and re-harvests
 * mention IDs whenever it is, so edits never wipe formatting or leave stale mentions.
 *
 * `stickers` is always rewritten so removed inline tokens do not linger. Pass `previous`
 * (the message being edited) to keep stickers that were attached explicitly and tokens
 * in `richContent` that this edit leaves in place.
 */
export function buildMessageEdit(
  content: string,
  richContent?: string,
  previous?: MessageEditSource
): Partial<Message> {
  const updates: Partial<Message> = { content };
  if (richContent !== undefined) {
    updates.richContent = richContent;
    updates.mentions = extractMentionIdsFromHtml(richContent);
  }
  const previousInline = previous
    ? new Set(extractMessageStickers(previous.content, previous.richContent))
    : undefined;
  const explicit = previous?.stickers?.filter(s => !previousInline?.has(s));
  updates.stickers = mergeMessageStickers(
    explicit,
    content,
    richContent ?? previous?.richContent
  );
  return updates;
}
