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
});
