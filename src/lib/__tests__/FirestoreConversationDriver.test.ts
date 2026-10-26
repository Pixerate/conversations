import { describe, it, expect, vi } from 'vitest';
import { FirestoreConversationDriver } from '../drivers/FirestoreConversationDriver.js';
import type { Conversation, Message } from '../types.js';
import { createAdminDb, createModularDb, type FakeFirestore } from './fakes/fakeFirestore.js';

vi.mock('firebase/firestore', async () => {
  const { modularFirestore } = await import('./fakes/fakeFirestore.js');
  return modularFirestore;
});

const alice = { type: 'user' as const, id: 'user-1', name: 'Alice' };

describe('FirestoreConversationDriver', () => {
  it('throws an error if db is not provided', () => {
    expect(() => new FirestoreConversationDriver({} as any)).toThrow(
      'FirestoreConversationDriver requires a Firestore instance (db).'
    );
  });

  describe.each([
    ['Admin SDK', createAdminDb],
    ['Modular SDK', createModularDb]
  ])('%s', (_name, createDb) => {
    function setup(): { driver: FirestoreConversationDriver; fs: FakeFirestore } {
      const { db, fs } = createDb();
      return { driver: new FirestoreConversationDriver({ db }), fs };
    }

    async function setupWithConversation() {
      const ctx = setup();
      await ctx.driver.createConversation({
        id: 'convo-1',
        entity: { id: 'task-100', type: 'task' }
      });
      return ctx;
    }

    it('creates and retrieves a conversation', async () => {
      const { driver } = await setupWithConversation();

      const retrieved = await driver.getConversation('convo-1');
      expect(retrieved?.id).toBe('convo-1');
      expect(retrieved?.status).toBe('open');
      expect(await driver.getConversation('missing')).toBeNull();
    });

    it('finds conversations by entity id and type', async () => {
      const { driver } = await setupWithConversation();
      await driver.createConversation({ id: 'convo-2', entity: { id: 'task-100', type: 'doc' } });

      expect((await driver.getConversationByEntity('task-100', 'doc'))?.id).toBe('convo-2');
      expect((await driver.getConversationByEntity('task-100', 'task'))?.id).toBe('convo-1');
      expect(await driver.getConversationByEntity('task-999')).toBeNull();
    });

    it('resolves and reopens a conversation, clearing resolution fields', async () => {
      const { driver, fs } = await setupWithConversation();

      const resolved = await driver.updateConversationStatus('convo-1', 'resolved', 'user-1');
      expect(resolved.resolvedBy).toBe('user-1');

      await driver.updateConversationStatus('convo-1', 'open');
      const stored = fs.raw('conversations/convo-1')!;
      expect(stored.status).toBe('open');
      expect(stored).not.toHaveProperty('resolvedAt');
      expect(stored).not.toHaveProperty('resolvedBy');
    });

    it('posts, lists, updates, and deletes messages via subcollection', async () => {
      const { driver, fs } = await setupWithConversation();

      const message = await driver.postMessage({
        conversationId: 'convo-1',
        author: alice,
        content: 'Hello world',
        richContent: '<p>Hello <b>world</b></p>'
      });
      expect(fs.raw(`conversations/convo-1/messages/${message.id}`)?.content).toBe('Hello world');

      const convo = fs.raw('conversations/convo-1') as Conversation;
      expect(convo.messageCount).toBe(1);
      expect(convo.participantIds).toEqual(['user-1']);

      expect(await driver.listMessages('convo-1')).toHaveLength(1);

      const updated = await driver.updateMessage(message.id, { content: 'Edited' }, 'convo-1');
      expect(updated.content).toBe('Edited');
      expect(updated.richContent).toBe('<p>Hello <b>world</b></p>');

      const deleted = await driver.deleteMessage(message.id, 'convo-1');
      expect(deleted.status).toBe('deleted');
      expect(deleted.content).toBe('[This comment was deleted]');
      expect(fs.raw(`conversations/convo-1/messages/${message.id}`)).not.toHaveProperty(
        'richContent'
      );
    });

    it('rejects posting to a missing conversation', async () => {
      const { driver } = setup();
      await expect(
        driver.postMessage({ conversationId: 'nope', author: alice, content: 'x' })
      ).rejects.toThrow('Conversation not found: nope');
    });

    it('adds, removes, and toggles reactions', async () => {
      const { driver } = await setupWithConversation();
      const message = await driver.postMessage({
        conversationId: 'convo-1',
        author: alice,
        content: 'Great work'
      });

      const withReaction = await driver.addReaction(
        message.id,
        { emoji: '🚀', userId: 'user-2' },
        'convo-1'
      );
      expect(withReaction.reactions).toHaveLength(1);

      const same = await driver.addReaction(message.id, { emoji: '🚀', userId: 'user-2' }, 'convo-1');
      expect(same.reactions).toHaveLength(1);

      const removed = await driver.removeReaction(message.id, '🚀', 'user-2', 'convo-1');
      expect(removed.reactions).toHaveLength(0);

      const toggledOn = await driver.toggleReaction(
        message.id,
        { emoji: '🎉', userId: 'user-2' },
        'convo-1'
      );
      expect(toggledOn.reactions.map(r => r.emoji)).toEqual(['🎉']);
      const toggledOff = await driver.toggleReaction(
        message.id,
        { emoji: '🎉', userId: 'user-2' },
        'convo-1'
      );
      expect(toggledOff.reactions).toHaveLength(0);

      await expect(
        driver.toggleReaction(message.id, { emoji: '🎉', userId: 'user-2' })
      ).rejects.toThrow('requires conversationId');
    });

    it('keeps messageCount and participants exact under concurrent posts', async () => {
      const { driver, fs } = await setupWithConversation();

      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          driver.postMessage({
            conversationId: 'convo-1',
            author: { type: 'user', id: `user-${i}`, name: `User ${i}` },
            content: `Message ${i}`
          })
        )
      );

      const convo = fs.raw('conversations/convo-1') as Conversation;
      expect(convo.messageCount).toBe(5);
      expect([...convo.participantIds].sort()).toEqual([
        'user-0',
        'user-1',
        'user-2',
        'user-3',
        'user-4'
      ]);
      expect(await driver.listMessages('convo-1')).toHaveLength(5);
      expect(fs.transactionRetries).toBeGreaterThan(0);
    });

    it('keeps every reaction and edit under concurrent message updates', async () => {
      const { driver, fs } = await setupWithConversation();
      const message = await driver.postMessage({
        conversationId: 'convo-1',
        author: alice,
        content: 'Original'
      });

      await Promise.all([
        driver.addReaction(message.id, { emoji: '👍', userId: 'user-a' }, 'convo-1'),
        driver.addReaction(message.id, { emoji: '🎉', userId: 'user-b' }, 'convo-1'),
        driver.toggleReaction(message.id, { emoji: '🚀', userId: 'user-c' }, 'convo-1'),
        driver.updateMessage(message.id, { content: 'Edited' }, 'convo-1')
      ]);

      const stored = fs.raw(`conversations/convo-1/messages/${message.id}`) as Message;
      expect(stored.content).toBe('Edited');
      expect(stored.reactions.map(r => r.emoji).sort()).toEqual(['🎉', '👍', '🚀'].sort());
    });

    it('strips nested undefined values before writing', async () => {
      const { driver, fs } = setup();

      await driver.createConversation({
        id: 'convo-1',
        entity: { id: 'task-100', type: 'task', title: undefined, metadata: { owner: undefined } },
        metadata: { tags: ['a', undefined as unknown as string] }
      });
      const message = await driver.postMessage({
        conversationId: 'convo-1',
        author: { type: 'user', id: 'user-1', name: 'Alice', avatarUrl: undefined } as any,
        content: 'Hi',
        metadata: { nested: { keep: 1, drop: undefined } }
      });

      const convo = fs.raw('conversations/convo-1')!;
      expect(convo.entity).toEqual({ id: 'task-100', type: 'task', metadata: {} });
      expect(convo.metadata).toEqual({ tags: ['a'] });

      const stored = fs.raw(`conversations/convo-1/messages/${message.id}`)!;
      expect(stored.author).toEqual({ type: 'user', id: 'user-1', name: 'Alice' });
      expect(stored.metadata).toEqual({ nested: { keep: 1 } });
    });

    it('delivers the first conversation update only once messages have loaded', async () => {
      const { driver } = await setupWithConversation();
      await driver.postMessage({ conversationId: 'convo-1', author: alice, content: 'One' });
      await driver.postMessage({ conversationId: 'convo-1', author: alice, content: 'Two' });

      const updates: Array<{ c: Conversation | null; m: Message[] }> = [];
      const unsub = driver.subscribeToConversation('convo-1', (c, m) => updates.push({ c, m }));

      await vi.waitFor(() => expect(updates.length).toBeGreaterThan(0));
      expect(updates[0].c?.id).toBe('convo-1');
      expect(updates[0].m.map(m => m.content)).toEqual(['One', 'Two']);

      await driver.postMessage({ conversationId: 'convo-1', author: alice, content: 'Three' });
      await vi.waitFor(() => {
        const last = updates[updates.length - 1];
        expect(last.m).toHaveLength(3);
        expect(last.c?.messageCount).toBe(3);
      });

      unsub();
    });

    it('does not leave a listener behind when unsubscribed before it attaches', async () => {
      const { driver, fs } = await setupWithConversation();
      const onUpdate = vi.fn();
      const onEntityUpdate = vi.fn();

      driver.subscribeToConversation('convo-1', onUpdate)();
      driver.subscribeToEntityConversations('task-100', onEntityUpdate)();

      await new Promise(resolve => setTimeout(resolve, 20));
      expect(fs.listenerCount()).toBe(0);
      expect(onUpdate).not.toHaveBeenCalled();
      expect(onEntityUpdate).not.toHaveBeenCalled();
    });

    it('subscribes to entity conversations and stops after unsubscribe', async () => {
      const { driver, fs } = await setupWithConversation();

      const entityUpdates: Conversation[][] = [];
      const unsub = driver.subscribeToEntityConversations('task-100', convos => {
        entityUpdates.push(convos);
      });

      await vi.waitFor(() => expect(entityUpdates).toHaveLength(1));
      expect(entityUpdates[0][0].id).toBe('convo-1');

      unsub();
      expect(fs.listenerCount()).toBe(0);
    });
  });
});
