import { describe, it, expect } from 'vitest';
import { groupReactions, hasUserReacted } from '../core/reactions.js';
import type { MessageReaction } from '../types.js';

describe('reactions', () => {
  it('groups multiple reactions for the same emoji and computes counts', () => {
    const reactions: MessageReaction[] = [
      { emoji: '👍', userId: 'u1' },
      { emoji: '👍', userId: 'u2' },
      { emoji: '🚀', userId: 'u3' }
    ];

    const grouped = groupReactions(reactions);
    expect(grouped).toHaveLength(2);

    const thumbsUp = grouped.find(g => g.emoji === '👍');
    expect(thumbsUp).toBeDefined();
    expect(thumbsUp?.count).toBe(2);
    expect(thumbsUp?.users).toEqual(['u1', 'u2']);
    expect(thumbsUp?.tooltip).toBe('u1, u2 reacted with 👍');

    const rocket = grouped.find(g => g.emoji === '🚀');
    expect(rocket?.count).toBe(1);
    expect(rocket?.tooltip).toBe('u3 reacted with 🚀');
  });

  it('identifies when current user has reacted', () => {
    const reactions: MessageReaction[] = [
      { emoji: '🎉', userId: 'current_user' },
      { emoji: '❤️', userId: 'other_user' }
    ];

    const grouped = groupReactions(reactions, 'current_user');
    const celebration = grouped.find(g => g.emoji === '🎉');
    const heart = grouped.find(g => g.emoji === '❤️');

    expect(celebration?.hasReacted).toBe(true);
    expect(heart?.hasReacted).toBe(false);
  });

  it('uses nameResolver to format user names in tooltip', () => {
    const reactions: MessageReaction[] = [
      { emoji: '🔥', userId: 'u1' },
      { emoji: '🔥', userId: 'agent_coder' }
    ];

    const resolver = (uid: string) => {
      if (uid === 'u1') return 'Alice';
      if (uid === 'agent_coder') return 'Coder Agent';
      return uid;
    };

    const grouped = groupReactions(reactions, undefined, resolver);
    const fire = grouped.find(g => g.emoji === '🔥');

    expect(fire?.userNames).toEqual(['Alice', 'Coder Agent']);
    expect(fire?.tooltip).toBe('Alice, Coder Agent reacted with 🔥');
  });

  it('hasUserReacted accurately reports user status', () => {
    const reactions: MessageReaction[] = [
      { emoji: '👀', userId: 'u1' }
    ];

    expect(hasUserReacted(reactions, '👀', 'u1')).toBe(true);
    expect(hasUserReacted(reactions, '👀', 'u2')).toBe(false);
    expect(hasUserReacted(reactions, '🚀', 'u1')).toBe(false);
  });

  it('handles empty reaction list safely', () => {
    expect(groupReactions([])).toEqual([]);
    expect(hasUserReacted([], '👍', 'u1')).toBe(false);
  });

  it('groups and matches sticker reactions alongside emoji reactions', () => {
    const reactions: MessageReaction[] = [
      { emoji: ':heart:', sticker: 'heart', userId: 'u1' },
      { emoji: ':heart:', userId: 'u2' },
      { emoji: ':pixerate-party-popper:', sticker: 'pixerate-party-popper', userId: 'agent_1' }
    ];

    const grouped = groupReactions(reactions, 'u2');
    expect(grouped).toHaveLength(2);

    const heartGroup = grouped.find(g => g.sticker === 'heart');
    expect(heartGroup).toBeDefined();
    expect(heartGroup?.emoji).toBe(':heart:');
    expect(heartGroup?.count).toBe(2);
    expect(heartGroup?.hasReacted).toBe(true);
    expect(heartGroup?.tooltip).toBe('u1, u2 reacted with :heart:');

    expect(hasUserReacted(reactions, ':heart:', 'u1')).toBe(true);
    expect(hasUserReacted(reactions, { sticker: 'heart' }, 'u2')).toBe(true);
    expect(hasUserReacted(reactions, ':pixerate-party-popper:', 'agent_1')).toBe(true);
  });
});

describe('sticker reaction identity', () => {
  it('does not treat a plain emoji and a sticker sharing that emoji as the same reaction', () => {
    expect(hasUserReacted([{ emoji: '👍', userId: 'u' }], { emoji: '👍', sticker: 'thumb' }, 'u')).toBe(
      false
    );
    expect(
      hasUserReacted([{ emoji: '👍', sticker: 'thumb', userId: 'u' }], '👍', 'u')
    ).toBe(false);
    expect(
      hasUserReacted(
        [{ emoji: '❤️', sticker: 'a', userId: 'u' }],
        { emoji: '❤️', sticker: 'b' },
        'u'
      )
    ).toBe(false);
  });

  it('still matches a sticker reaction by its shortcode or sticker id', () => {
    const reactions = [{ emoji: '❤️', sticker: 'heart', userId: 'u' }];
    expect(hasUserReacted(reactions, ':heart:', 'u')).toBe(true);
    expect(hasUserReacted(reactions, { sticker: 'heart' }, 'u')).toBe(true);
  });
});
