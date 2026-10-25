import { describe, it, expect, vi } from 'vitest';
import { FirestoreConversationDriver } from '../drivers/FirestoreConversationDriver.js';
import type { Conversation, Message } from '../types.js';

describe('FirestoreConversationDriver', () => {
  it('throws an error if db is not provided', () => {
    expect(() => new FirestoreConversationDriver({} as any)).toThrow(
      'FirestoreConversationDriver requires a Firestore instance (db).'
    );
  });

  describe('Classic / Admin SDK interface', () => {
    function createMockClassicDb() {
      const store: {
        conversations: Map<string, any>;
        messages: Map<string, Map<string, any>>;
      } = {
        conversations: new Map(),
        messages: new Map(),
      };

      const db = {
        collection: (colName: string) => {
          return {
            doc: (docId: string) => {
              return {
                get: vi.fn().mockImplementation(async () => {
                  const data = store.conversations.get(docId);
                  return {
                    exists: !!data,
                    data: () => data,
                  };
                }),
                set: vi.fn().mockImplementation(async (data: any) => {
                  store.conversations.set(docId, data);
                }),
                update: vi.fn().mockImplementation(async (updates: any) => {
                  const existing = store.conversations.get(docId) || {};
                  store.conversations.set(docId, { ...existing, ...updates });
                }),
                collection: (subColName: string) => {
                  if (!store.messages.has(docId)) {
                    store.messages.set(docId, new Map());
                  }
                  const subStore = store.messages.get(docId)!;
                  return {
                    doc: (subDocId: string) => ({
                      get: vi.fn().mockImplementation(async () => {
                        const data = subStore.get(subDocId);
                        return {
                          exists: !!data,
                          data: () => data,
                        };
                      }),
                      set: vi.fn().mockImplementation(async (data: any) => {
                        subStore.set(subDocId, data);
                      }),
                    }),
                    orderBy: (field: string, dir: string) => ({
                      get: vi.fn().mockImplementation(async () => {
                        const msgs = Array.from(subStore.values());
                        return {
                          docs: msgs.map(m => ({ data: () => m })),
                        };
                      }),
                      onSnapshot: vi.fn().mockImplementation((cb: any) => {
                        const msgs = Array.from(subStore.values());
                        cb({ docs: msgs.map(m => ({ data: () => m })) });
                        return vi.fn();
                      }),
                    }),
                  };
                },
                onSnapshot: vi.fn().mockImplementation((cb: any) => {
                  const data = store.conversations.get(docId);
                  cb({ exists: !!data, data: () => data });
                  return vi.fn();
                }),
              };
            },
            where: (field: string, op: string, val: any) => ({
              get: vi.fn().mockImplementation(async () => {
                const results: any[] = [];
                for (const convo of store.conversations.values()) {
                  if (field === 'entity.id' && convo.entity?.id === val) {
                    results.push(convo);
                  }
                }
                return {
                  docs: results.map(c => ({ data: () => c })),
                };
              }),
              onSnapshot: vi.fn().mockImplementation((cb: any) => {
                const results: any[] = [];
                for (const convo of store.conversations.values()) {
                  if (field === 'entity.id' && convo.entity?.id === val) {
                    results.push(convo);
                  }
                }
                cb({ docs: results.map(c => ({ data: () => c })) });
                return vi.fn();
              }),
            }),
          };
        },
      };

      return { db, store };
    }

    it('creates and retrieves a conversation', async () => {
      const { db } = createMockClassicDb();
      const driver = new FirestoreConversationDriver({ db });

      const convo = await driver.createConversation({
        id: 'convo-1',
        entity: { id: 'task-100', type: 'task' },
      });

      expect(convo.id).toBe('convo-1');
      expect(convo.status).toBe('open');

      const retrieved = await driver.getConversation('convo-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('convo-1');
    });

    it('posts, updates, and deletes messages via subcollection', async () => {
      const { db } = createMockClassicDb();
      const driver = new FirestoreConversationDriver({ db });

      await driver.createConversation({
        id: 'convo-1',
        entity: { id: 'task-100', type: 'task' },
      });

      const message = await driver.postMessage({
        conversationId: 'convo-1',
        author: { type: 'user', id: 'user-1', name: 'Alice' },
        content: 'Hello world',
      });

      expect(message.content).toBe('Hello world');
      expect(message.id).toBeDefined();

      const messages = await driver.listMessages('convo-1');
      expect(messages.length).toBe(1);

      const updated = await driver.updateMessage(message.id, { content: 'Edited' }, 'convo-1');
      expect(updated.content).toBe('Edited');

      const deleted = await driver.deleteMessage(message.id, 'convo-1');
      expect(deleted.status).toBe('deleted');
      expect(deleted.content).toBe('[This comment was deleted]');
    });

    it('adds and removes reactions on messages', async () => {
      const { db } = createMockClassicDb();
      const driver = new FirestoreConversationDriver({ db });

      await driver.createConversation({
        id: 'convo-1',
        entity: { id: 'task-100', type: 'task' },
      });

      const message = await driver.postMessage({
        conversationId: 'convo-1',
        author: { type: 'user', id: 'user-1', name: 'Alice' },
        content: 'Great work',
      });

      const withReaction = await driver.addReaction(
        message.id,
        { emoji: '🚀', userId: 'user-2' },
        'convo-1'
      );
      expect(withReaction.reactions?.length).toBe(1);
      expect(withReaction.reactions?.[0].emoji).toBe('🚀');

      // Idempotent add
      const same = await driver.addReaction(
        message.id,
        { emoji: '🚀', userId: 'user-2' },
        'convo-1'
      );
      expect(same.reactions?.length).toBe(1);

      // Remove reaction
      const withoutReaction = await driver.removeReaction(
        message.id,
        '🚀',
        'user-2',
        'convo-1'
      );
      expect(withoutReaction.reactions?.length).toBe(0);
    });

    it('subscribes to conversation changes and entity conversations', async () => {
      const { db } = createMockClassicDb();
      const driver = new FirestoreConversationDriver({ db });

      await driver.createConversation({
        id: 'convo-1',
        entity: { id: 'task-100', type: 'task' },
      });

      const convoUpdates: any[] = [];
      const unsubConvo = driver.subscribeToConversation('convo-1', (c, m) => {
        convoUpdates.push({ c, m });
      });

      expect(convoUpdates.length).toBeGreaterThan(0);
      expect(typeof unsubConvo).toBe('function');
      unsubConvo();

      const entityUpdates: any[] = [];
      const unsubEntity = driver.subscribeToEntityConversations('task-100', convos => {
        entityUpdates.push(convos);
      });

      expect(entityUpdates.length).toBe(1);
      expect(entityUpdates[0][0].id).toBe('convo-1');
      unsubEntity();
    });
  });
});
