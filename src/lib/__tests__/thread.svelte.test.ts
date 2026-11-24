import { describe, it, expect, vi } from 'vitest';
import { ThreadStore } from '../svelte/thread.svelte.js';
import { MemoryConversationDriver } from '../drivers/MemoryConversationDriver.js';

const alice = { type: 'user' as const, id: 'user_alice', name: 'Alice' };
const richHello = '<p>Hello <span data-type="mention" data-id="user_bob">@Bob</span></p>';

async function setup() {
  const driver = new MemoryConversationDriver();
  const convo = await driver.createConversation({ entity: { id: 'task_1', type: 'task' } });
  const msg = await driver.postMessage({
    conversationId: convo.id,
    author: alice,
    content: 'Hello Bob',
    richContent: richHello,
    mentions: ['user_bob']
  });
  const store = new ThreadStore(driver, convo.id);
  return { driver, convo, msg, store };
}

describe('ThreadStore (Svelte 5)', () => {
  it('editMessage keeps richContent when only plain content changes', async () => {
    const { msg, store } = await setup();

    const edited = await store.editMessage(msg.id, 'Hello Bob!');
    expect(edited.content).toBe('Hello Bob!');
    expect(edited.richContent).toBe(richHello);
    expect(edited.mentions).toEqual(['user_bob']);
    store.destroy();
  });

  it('editMessage re-harvests mentions from new rich content', async () => {
    const { msg, store } = await setup();

    const edited = await store.editMessage(
      msg.id,
      'Hello Carol',
      '<p>Hello <span data-type="mention" data-id="user_carol">@Carol</span></p>'
    );
    expect(edited.mentions).toEqual(['user_carol']);
    store.destroy();
  });

  it('toggleReaction delegates the add/remove decision to the driver', async () => {
    const { driver, convo, msg, store } = await setup();
    const toggleSpy = vi.spyOn(driver, 'toggleReaction');

    expect((await store.toggleReaction(msg.id, '👍', 'user_bob')).reactions).toHaveLength(1);
    expect((await store.toggleReaction(msg.id, '👍', 'user_bob')).reactions).toHaveLength(0);
    expect(toggleSpy).toHaveBeenCalledWith(msg.id, { emoji: '👍', userId: 'user_bob' }, convo.id);
    store.destroy();
  });

  it('supports sticker reactions and inline sticker extraction on postReply', async () => {
    const { store } = await setup();

    const reply = await store.postReply('Shipped :heart:!', alice);
    expect(reply.stickers).toEqual(['heart']);

    const reacted = await store.toggleStickerReaction(reply.id, 'heart', 'user_bob');
    expect(reacted.reactions).toHaveLength(1);
    expect(reacted.reactions[0]).toMatchObject({
      emoji: ':heart:',
      sticker: 'heart',
      userId: 'user_bob'
    });

    const grouped = store.getGroupedReactions(reply.id, 'user_bob');
    expect(grouped[0]).toMatchObject({
      emoji: ':heart:',
      sticker: 'heart',
      count: 1,
      hasReacted: true
    });

    const toggledOff = await store.toggleStickerReaction(reply.id, 'heart', 'user_bob');
    expect(toggledOff.reactions).toHaveLength(0);
    store.destroy();
  });

  it('tracks reactive anchor state and supports updateAnchor', async () => {
    const driver = new MemoryConversationDriver();
    const convo = await driver.createConversation({
      entity: { id: 'doc_1', type: 'document' },
      anchor: {
        start: 2,
        end: 7,
        quote: { exact: 'hello' },
        state: 'attached'
      }
    });

    const store = new ThreadStore(driver, convo.id);
    expect(store.anchor).toEqual({
      start: 2,
      end: 7,
      quote: { exact: 'hello' },
      state: 'attached'
    });

    await store.updateAnchor({
      start: 5,
      end: 10,
      quote: { exact: 'hello' },
      state: 'attached'
    });
    expect(store.anchor?.start).toBe(5);

    await store.updateAnchor(null);
    expect(store.anchor).toBeNull();
    store.destroy();
  });
});
