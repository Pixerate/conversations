import { describe, it, expect } from 'vitest';
import { buildMessageEdit } from '../core/messageEdits.js';

describe('buildMessageEdit', () => {
  it('omits richContent and mentions for a plain-text edit', () => {
    const updates = buildMessageEdit('fixed typo');
    expect(updates).toEqual({ content: 'fixed typo' });
    expect(updates).not.toHaveProperty('richContent');
    expect(updates).not.toHaveProperty('mentions');
  });

  it('re-harvests mentions from new rich content', () => {
    const updates = buildMessageEdit('hi Bob', '<p>hi <span data-type="mention" data-id="user_bob">@Bob</span></p>');
    expect(updates.richContent).toContain('user_bob');
    expect(updates.mentions).toEqual(['user_bob']);
  });

  it('clears mentions when rich content is set to empty', () => {
    expect(buildMessageEdit('', '')).toEqual({ content: '', richContent: '', mentions: [] });
  });
});
