import { describe, it, expect } from 'vitest';
import {
  reconcileOptimisticMessages,
  reconcileAndMergeMessages
} from '../core/reconciliation.js';
import type { Message } from '../types.js';

describe('reconciliation', () => {
  const authorAlice = { type: 'user' as const, id: 'user_alice', name: 'Alice' };
  const authorBob = { type: 'user' as const, id: 'user_bob', name: 'Bob' };

  function makeMsg(
    id: string,
    content: string,
    author = authorAlice,
    createdAt = '2026-10-25T12:00:00Z',
    parentId: string | null = null
  ): Message {
    return {
      id,
      conversationId: 'convo_1',
      author,
      content,
      parentId,
      status: 'sent',
      mentions: [],
      attachments: [],
      reactions: [],
      createdAt
    };
  }

  it('preserves array reference equality when no optimistic messages are reconciled', () => {
    const optimistic = [makeMsg('temp_1', 'Pending comment')];
    const server = [makeMsg('srv_1', 'Different comment')];

    const result = reconcileOptimisticMessages(optimistic, server);
    expect(result).toBe(optimistic);
  });

  it('reconciles optimistic messages matching by exact ID', () => {
    const opt = makeMsg('msg_exact', 'Same message');
    const server = [makeMsg('msg_exact', 'Same message')];

    const result = reconcileOptimisticMessages([opt], server);
    expect(result).toHaveLength(0);
  });

  it('reconciles optimistic message by author, content, and timestamp window (within 10s)', () => {
    const opt = makeMsg('temp_1', 'Hello world', authorAlice, '2026-10-25T12:00:00.000Z');
    const srv = makeMsg('server_real_id', 'Hello world', authorAlice, '2026-10-25T12:00:04.500Z');

    const result = reconcileOptimisticMessages([opt], [srv]);
    expect(result).toHaveLength(0);
  });

  it('does NOT reconcile if timestamp difference exceeds windowMs', () => {
    const opt = makeMsg('temp_1', 'Hello world', authorAlice, '2026-10-25T12:00:00.000Z');
    const srv = makeMsg('server_real_id', 'Hello world', authorAlice, '2026-10-25T12:00:15.000Z');

    const result = reconcileOptimisticMessages([opt], [srv], 10_000);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('temp_1');
  });

  it('does NOT reconcile if author is different despite identical content and time', () => {
    const opt = makeMsg('temp_1', 'Identical content', authorAlice, '2026-10-25T12:00:00Z');
    const srv = makeMsg('srv_1', 'Identical content', authorBob, '2026-10-25T12:00:00Z');

    const result = reconcileOptimisticMessages([opt], [srv]);
    expect(result).toHaveLength(1);
  });

  it('does NOT reconcile if parentId differs (e.g. root vs reply to another comment)', () => {
    const opt = makeMsg('temp_1', 'Reply comment', authorAlice, '2026-10-25T12:00:00Z', 'parent_A');
    const srv = makeMsg('srv_1', 'Reply comment', authorAlice, '2026-10-25T12:00:00Z', 'parent_B');

    const result = reconcileOptimisticMessages([opt], [srv]);
    expect(result).toHaveLength(1);
  });

  it('reconciles nested replies in tree structure', () => {
    const opt = makeMsg('temp_reply', 'Nested reply', authorAlice, '2026-10-25T12:00:02Z', 'srv_root');
    const serverTree = [
      {
        id: 'srv_root',
        content: 'Root',
        createdAt: '2026-10-25T11:59:00Z',
        author: authorBob,
        children: [
          makeMsg('srv_reply_confirmed', 'Nested reply', authorAlice, '2026-10-25T12:00:03Z', 'srv_root')
        ]
      }
    ];

    const result = reconcileOptimisticMessages([opt], serverTree as any);
    expect(result).toHaveLength(0);
  });

  it('reconcileAndMergeMessages combines server messages and remaining optimistic messages', () => {
    const optReconciled = makeMsg('temp_1', 'First', authorAlice, '2026-10-25T12:00:00Z');
    const optPending = makeMsg('temp_2', 'Second pending', authorAlice, '2026-10-25T12:05:00Z');
    const srvFirst = makeMsg('srv_1', 'First', authorAlice, '2026-10-25T12:00:01Z');

    const merged = reconcileAndMergeMessages([optReconciled, optPending], [srvFirst]);
    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe('srv_1');
    expect(merged[1].id).toBe('temp_2');
  });

  it('reconciles messages with flat authorId property', () => {
    const optFlat = {
      id: 'opt_flat_1',
      authorId: 'user_alex',
      content: 'Flat author comment',
      createdAt: '2026-10-25T12:00:00Z',
      parentId: null
    };
    const srvFlat = {
      id: 'srv_flat_1',
      authorId: 'user_alex',
      content: 'Flat author comment',
      createdAt: '2026-10-25T12:00:02Z',
      parentId: null
    };
    const result = reconcileOptimisticMessages([optFlat], [srvFlat]);
    expect(result).toHaveLength(0);
  });

  it('handles empty optimistic or server lists gracefully', () => {
    const opt = makeMsg('temp_1', 'Pending');
    expect(reconcileOptimisticMessages([], [opt])).toEqual([]);
    expect(reconcileOptimisticMessages([opt], [])).toEqual([opt]);
  });
});
