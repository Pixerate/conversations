import { describe, it, expect } from 'vitest';
import { ThreadTree } from '../core/ThreadTree.js';
import type { Message } from '../types.js';

describe('ThreadTree', () => {
  const baseAuthor = { type: 'user' as const, id: 'user_1', name: 'Alice' };

  function makeMsg(id: string, parentId?: string | null, createdAt = '2026-10-25T10:00:00Z'): Message {
    return {
      id,
      conversationId: 'convo_1',
      author: baseAuthor,
      content: `Message ${id}`,
      parentId: parentId || null,
      status: 'sent',
      mentions: [],
      attachments: [],
      reactions: [],
      createdAt
    };
  }

  it('builds a simple single root hierarchy', () => {
    const messages: Message[] = [
      makeMsg('root1', null, '2026-10-25T10:00:00Z'),
      makeMsg('reply1', 'root1', '2026-10-25T10:01:00Z'),
      makeMsg('reply2', 'root1', '2026-10-25T10:02:00Z')
    ];

    const tree = ThreadTree.buildTree(messages);
    expect(tree).toHaveLength(1);
    expect(tree[0].message.id).toBe('root1');
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].message.id).toBe('reply1');
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[0].children[1].message.id).toBe('reply2');
    expect(tree[0].children[1].depth).toBe(1);
  });

  it('builds deep nested replies (10+ levels)', () => {
    const messages: Message[] = [makeMsg('m0')];
    for (let i = 1; i <= 10; i++) {
      messages.push(makeMsg(`m${i}`, `m${i - 1}`));
    }

    const tree = ThreadTree.buildTree(messages);
    expect(tree).toHaveLength(1);

    let curr = tree[0];
    for (let i = 1; i <= 10; i++) {
      expect(curr.children).toHaveLength(1);
      expect(curr.children[0].message.id).toBe(`m${i}`);
      expect(curr.children[0].depth).toBe(i);
      curr = curr.children[0];
    }
  });

  it('detects and breaks cyclic parent-child references', () => {
    // Cycle: c1 -> c2 -> c1
    const messages: Message[] = [
      makeMsg('c1', 'c2'),
      makeMsg('c2', 'c1')
    ];

    // Should not throw or infinite loop
    const tree = ThreadTree.buildTree(messages);
    expect(tree.length).toBeGreaterThan(0);
    const flattened = ThreadTree.flattenTree(tree);
    expect(flattened).toHaveLength(2);
  });

  it('keeps replies below a cycle attached to their parent', () => {
    // Cycle: c1 <-> c2, with reply -> c1 and nested -> reply hanging off it
    const messages: Message[] = [
      makeMsg('c1', 'c2', '2026-10-25T10:00:00Z'),
      makeMsg('c2', 'c1', '2026-10-25T10:01:00Z'),
      makeMsg('reply', 'c1', '2026-10-25T10:02:00Z'),
      makeMsg('nested', 'reply', '2026-10-25T10:03:00Z')
    ];

    const tree = ThreadTree.buildTree(messages);
    expect(tree.map(n => n.message.id)).toEqual(['c1', 'c2']);

    const c1 = ThreadTree.findNode(tree, 'c1')!;
    expect(c1.children.map(n => n.message.id)).toEqual(['reply']);
    expect(c1.children[0].children.map(n => n.message.id)).toEqual(['nested']);
    expect(ThreadTree.findNode(tree, 'nested')?.depth).toBe(2);
    expect(ThreadTree.flattenTree(tree)).toHaveLength(4);
  });

  it('breaks self-referencing messages', () => {
    const tree = ThreadTree.buildTree([makeMsg('self', 'self')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].message.id).toBe('self');
    expect(tree[0].isSyntheticParent).toBe(false);
  });

  it('handles missing parent messages using placeholder strategy by default', () => {
    const messages: Message[] = [
      makeMsg('child1', 'deleted_parent')
    ];

    const tree = ThreadTree.buildTree(messages);
    expect(tree).toHaveLength(1);
    expect(tree[0].isSyntheticParent).toBe(true);
    expect(tree[0].message.id).toBe('deleted_parent');
    expect(tree[0].message.status).toBe('deleted');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].message.id).toBe('child1');
  });

  it('handles missing parent messages using root strategy', () => {
    const messages: Message[] = [
      makeMsg('child1', 'deleted_parent')
    ];

    const tree = ThreadTree.buildTree(messages, { orphanStrategy: 'root' });
    expect(tree).toHaveLength(1);
    expect(tree[0].message.id).toBe('child1');
    expect(tree[0].depth).toBe(0);
  });

  it('flattens tree into depth-first pre-order list', () => {
    const messages: Message[] = [
      makeMsg('r1', null, '2026-10-25T10:00:00Z'),
      makeMsg('r1_c1', 'r1', '2026-10-25T10:01:00Z'),
      makeMsg('r1_c1_sub', 'r1_c1', '2026-10-25T10:02:00Z'),
      makeMsg('r1_c2', 'r1', '2026-10-25T10:03:00Z'),
      makeMsg('r2', null, '2026-10-25T10:04:00Z')
    ];

    const tree = ThreadTree.buildTree(messages);
    const flat = ThreadTree.flattenTree(tree);

    const ids = flat.map(m => m.id);
    expect(ids).toEqual(['r1', 'r1_c1', 'r1_c1_sub', 'r1_c2', 'r2']);
  });

  it('counts descendants accurately', () => {
    const messages: Message[] = [
      makeMsg('r1'),
      makeMsg('c1', 'r1'),
      makeMsg('c2', 'r1'),
      makeMsg('c1_1', 'c1')
    ];

    const tree = ThreadTree.buildTree(messages);
    expect(ThreadTree.countDescendants(tree[0])).toBe(3);
    expect(ThreadTree.countDescendants(tree[0].children[0])).toBe(1);
    expect(ThreadTree.countDescendants(tree[0].children[1])).toBe(0);
  });

  it('finds node by id', () => {
    const messages: Message[] = [
      makeMsg('r1'),
      makeMsg('c1', 'r1'),
      makeMsg('c1_sub', 'c1')
    ];

    const tree = ThreadTree.buildTree(messages);
    const found = ThreadTree.findNode(tree, 'c1_sub');
    expect(found).not.toBeNull();
    expect(found?.message.id).toBe('c1_sub');
    expect(found?.depth).toBe(2);

    expect(ThreadTree.findNode(tree, 'non_existent')).toBeNull();
  });

  describe('buildCommentThreads', () => {
    it('builds self-nesting threaded comments array matching Operative structure', () => {
      const flat = [
        { id: 'c1', content: 'Root comment', parentId: null },
        { id: 'c2', content: 'Reply to root', parentId: 'c1' },
        { id: 'c3', content: 'Nested reply', parentId: 'c2' },
        { id: 'c4', content: 'Another root comment', parentId: null }
      ];

      const threaded = ThreadTree.buildCommentThreads(flat);
      expect(threaded).toHaveLength(2);
      expect(threaded[0].id).toBe('c1');
      expect(threaded[0].replies).toHaveLength(1);
      expect(threaded[0].replies[0].id).toBe('c2');
      expect(threaded[0].replies[0].replies).toHaveLength(1);
      expect(threaded[0].replies[0].replies[0].id).toBe('c3');
      expect(threaded[1].id).toBe('c4');
      expect(threaded[1].replies).toHaveLength(0);
    });

    it('breaks cycles in parentId pointers by placing cyclic nodes at root', () => {
      const cyclic = [
        { id: 'c1', content: 'Cycle 1', parentId: 'c2' },
        { id: 'c2', content: 'Cycle 2', parentId: 'c1' }
      ];

      const threaded = ThreadTree.buildCommentThreads(cyclic);
      expect(threaded).toBeDefined();
      expect(threaded.length).toBeGreaterThan(0);
    });

    it('handles empty input gracefully', () => {
      expect(ThreadTree.buildCommentThreads([])).toEqual([]);
    });
  });
});
