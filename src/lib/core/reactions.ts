import type { MessageReaction, GroupedReaction } from '../types.js';

/**
 * Aggregates emoji reactions into grouped summary items with tooltips and user participation.
 * Compatible with the Operative discussion reaction model.
 */
export function groupReactions(
  reactions: MessageReaction[] = [],
  currentUserId?: string,
  nameResolver?: (userId: string) => string
): GroupedReaction[] {
  const map = new Map<string, { count: number; users: string[]; hasReacted: boolean }>();

  for (const r of reactions) {
    if (!r || !r.emoji) continue;
    const existing = map.get(r.emoji) || { count: 0, users: [], hasReacted: false };
    existing.count++;
    existing.users.push(r.userId);
    if (currentUserId && r.userId === currentUserId) {
      existing.hasReacted = true;
    }
    map.set(r.emoji, existing);
  }

  return Array.from(map.entries()).map(([emoji, data]) => {
    const names = data.users.map(uid => (nameResolver ? nameResolver(uid) : uid));
    const formattedNames = names.join(', ');
    const tooltip = formattedNames
      ? `${formattedNames} reacted with ${emoji}`
      : `${data.count} reaction${data.count > 1 ? 's' : ''}`;
    return {
      emoji,
      count: data.count,
      hasReacted: data.hasReacted,
      users: data.users,
      userNames: names,
      tooltip
    };
  });
}

/**
 * Checks whether a specific user has reacted to a message with a given emoji.
 */
export function hasUserReacted(
  reactions: MessageReaction[] = [],
  emoji: string,
  userId: string
): boolean {
  return reactions.some(r => r.emoji === emoji && r.userId === userId);
}
