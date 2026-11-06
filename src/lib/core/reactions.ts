import type { MessageReaction, GroupedReaction } from '../types.js';
import {
  formatStickerShortcode,
  parseStickerShortcode,
  type StickerProviderInput
} from './stickers.js';

export type ReactionInput =
  | string
  | {
      emoji?: string;
      sticker?: string;
    };

const COLON_REF_REGEX = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

/**
 * Normalizes an emoji or sticker reaction input into `{ emoji, sticker? }`.
 * - Standard emoji (`"👍"`) -> `{ emoji: "👍" }`
 * - Sticker shortcode (`":heart:"`, `":pixerate-heart:"`) -> `{ emoji: ":heart:", sticker: "heart" }`
 * - Colon sticker ref (`"pixerate:heart"`) -> `{ emoji: ":heart:" | ":pixerate-heart:", sticker: "heart" | "pixerate-heart" }`
 * - Explicit `{ sticker: "heart" }` -> `{ emoji: ":heart:", sticker: "heart" }`
 */
export function normalizeReactionInput(
  input: ReactionInput,
  provider?: StickerProviderInput
): { emoji: string; sticker?: string } {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    const shortcodeId = parseStickerShortcode(trimmed);
    if (shortcodeId) {
      const formatted = formatStickerShortcode(shortcodeId, provider);
      const cleanSticker = parseStickerShortcode(formatted) ?? shortcodeId;
      return { emoji: formatted, sticker: cleanSticker };
    }
    if (COLON_REF_REGEX.test(trimmed)) {
      const formatted = formatStickerShortcode(trimmed, provider);
      const cleanSticker = parseStickerShortcode(formatted) ?? trimmed.replace(/:/g, '-');
      return { emoji: formatted, sticker: cleanSticker };
    }
    return { emoji: trimmed };
  }

  const rawSticker = input.sticker?.trim();
  const rawEmoji = input.emoji?.trim();

  if (rawSticker) {
    const formatted = formatStickerShortcode(rawSticker, provider);
    const cleanSticker =
      parseStickerShortcode(formatted) ?? rawSticker.replace(/^:+|:+$/g, '').replace(/:/g, '-');
    return {
      emoji: rawEmoji || formatted,
      sticker: cleanSticker
    };
  }

  if (rawEmoji) {
    return normalizeReactionInput(rawEmoji, provider);
  }

  throw new Error('Reaction requires either an emoji or a sticker identifier.');
}

function reactionMatchesKey(
  r: MessageReaction,
  target: { emoji: string; sticker?: string }
): boolean {
  if (!r) return false;
  if (r.emoji === target.emoji) return true;
  const rSticker = r.sticker ?? parseStickerShortcode(r.emoji) ?? undefined;
  if (target.sticker && rSticker) {
    return rSticker === target.sticker;
  }
  if (rSticker && target.emoji === rSticker) {
    return true;
  }
  return false;
}

/**
 * Aggregates emoji and sticker reactions into grouped summary items with tooltips and user participation.
 * Compatible with the Operative discussion reaction model.
 */
export function groupReactions(
  reactions: MessageReaction[] = [],
  currentUserId?: string,
  nameResolver?: (userId: string) => string
): GroupedReaction[] {
  const map = new Map<
    string,
    { emoji: string; sticker?: string; count: number; users: string[]; hasReacted: boolean }
  >();

  for (const r of reactions) {
    if (!r || (!r.emoji && !r.sticker)) continue;
    const stickerId =
      r.sticker ?? (r.emoji ? parseStickerShortcode(r.emoji) ?? undefined : undefined);
    const emojiDisplay = r.emoji || (stickerId ? `:${stickerId}:` : '');
    if (!emojiDisplay) continue;

    const key = stickerId ? `sticker:${stickerId}` : `emoji:${emojiDisplay}`;
    const existing = map.get(key) || {
      emoji: emojiDisplay,
      ...(stickerId ? { sticker: stickerId } : {}),
      count: 0,
      users: [],
      hasReacted: false
    };
    existing.count++;
    existing.users.push(r.userId);
    if (currentUserId && r.userId === currentUserId) {
      existing.hasReacted = true;
    }
    map.set(key, existing);
  }

  return Array.from(map.values()).map(data => {
    const names = data.users.map(uid => (nameResolver ? nameResolver(uid) : uid));
    const formattedNames = names.join(', ');
    const tooltip = formattedNames
      ? `${formattedNames} reacted with ${data.emoji}`
      : `${data.count} reaction${data.count > 1 ? 's' : ''}`;
    return {
      emoji: data.emoji,
      ...(data.sticker ? { sticker: data.sticker } : {}),
      count: data.count,
      hasReacted: data.hasReacted,
      users: data.users,
      userNames: names,
      tooltip
    };
  });
}

/**
 * Checks whether a specific user has reacted to a message with a given emoji or sticker.
 */
export function hasUserReacted(
  reactions: MessageReaction[] = [],
  emojiOrSticker: ReactionInput,
  userId: string,
  provider?: StickerProviderInput
): boolean {
  if (!reactions || reactions.length === 0) return false;
  const target = normalizeReactionInput(emojiOrSticker, provider);
  return reactions.some(r => r.userId === userId && reactionMatchesKey(r, target));
}
