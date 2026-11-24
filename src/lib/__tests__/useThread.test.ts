// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useThread } from '../react/useThread.js';
import { MemoryConversationDriver } from '../drivers/MemoryConversationDriver.js';

type ThreadApi = ReturnType<typeof useThread>;

const alice = { type: 'user' as const, id: 'user_alice', name: 'Alice' };
const richHello = '<p>Hello <span data-type="mention" data-id="user_bob">@Bob</span></p>';

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
});

function renderThread(driver: MemoryConversationDriver, conversationId: string) {
  const result: { current: ThreadApi | null } = { current: null };
  function Probe() {
    result.current = useThread(driver, conversationId);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  return { result, root };
}

async function seed(driver: MemoryConversationDriver, conversationId: string, content: string) {
  await driver.createConversation({ id: conversationId, entity: { id: 'task_1', type: 'task' } });
  return driver.postMessage({
    conversationId,
    author: alice,
    content,
    richContent: richHello,
    mentions: ['user_bob']
  });
}

describe('useThread (React)', () => {
  it('keeps separate state for the same conversation id on different drivers', async () => {
    const driverA = new MemoryConversationDriver();
    const driverB = new MemoryConversationDriver();
    await seed(driverA, 'convo_shared', 'From A');
    await seed(driverB, 'convo_shared', 'From B');

    const a = renderThread(driverA, 'convo_shared');
    const b = renderThread(driverB, 'convo_shared');

    expect(a.result.current?.messages.map(m => m.content)).toEqual(['From A']);
    expect(b.result.current?.messages.map(m => m.content)).toEqual(['From B']);
  });

  it('shares one driver subscription per thread and releases it after the last unmount', async () => {
    const driver = new MemoryConversationDriver();
    await seed(driver, 'convo_1', 'Hello');
    const subscribeSpy = vi.spyOn(driver, 'subscribeToConversation');

    const first = renderThread(driver, 'convo_1');
    const second = renderThread(driver, 'convo_1');
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    // Leave a pending optimistic message on the shared subscriber
    vi.spyOn(driver, 'postMessage').mockReturnValue(new Promise(() => {}));
    act(() => {
      void first.result.current!.postMessage('Pending', alice);
    });
    expect(second.result.current?.messages.map(m => m.content)).toEqual(['Hello', 'Pending']);

    act(() => first.root.unmount());
    act(() => second.root.unmount());
    roots.length = 0;

    // Evicted: a fresh mount gets a new subscriber, not the stale optimistic state
    const third = renderThread(driver, 'convo_1');
    expect(subscribeSpy).toHaveBeenCalledTimes(2);
    expect(third.result.current?.messages.map(m => m.content)).toEqual(['Hello']);
  });

  it('editMessage keeps richContent and mentions on a plain-text edit', async () => {
    const driver = new MemoryConversationDriver();
    const msg = await seed(driver, 'convo_edit', 'Hello Bob');
    const { result } = renderThread(driver, 'convo_edit');

    let edited: Awaited<ReturnType<ThreadApi['editMessage']>> | undefined;
    await act(async () => {
      edited = await result.current!.editMessage(msg.id, 'Hello Bob!');
    });

    expect(edited?.richContent).toBe(richHello);
    expect(edited?.mentions).toEqual(['user_bob']);
    expect(result.current?.messages[0].content).toBe('Hello Bob!');
  });

  it('toggleReaction adds then removes via the driver', async () => {
    const driver = new MemoryConversationDriver();
    const msg = await seed(driver, 'convo_react', 'React to me');
    const { result } = renderThread(driver, 'convo_react');

    await act(async () => {
      await result.current!.toggleReaction(msg.id, '🎉', 'user_bob');
    });
    expect(result.current?.messages[0].reactions).toHaveLength(1);

    await act(async () => {
      await result.current!.toggleReaction(msg.id, '🎉', 'user_bob');
    });
    expect(result.current?.messages[0].reactions).toHaveLength(0);
  });

  it('supports sticker reactions via toggleStickerReaction and getGroupedReactions', async () => {
    const driver = new MemoryConversationDriver();
    const msg = await seed(driver, 'convo_sticker_react', 'React with a sticker');
    const { result } = renderThread(driver, 'convo_sticker_react');

    await act(async () => {
      await result.current!.toggleStickerReaction(msg.id, 'pixerate-heart', 'agent_1');
    });
    expect(result.current?.messages[0].reactions).toHaveLength(1);
    expect(result.current?.messages[0].reactions[0]).toMatchObject({
      emoji: ':pixerate-heart:',
      sticker: 'pixerate-heart',
      userId: 'agent_1'
    });

    const grouped = result.current!.getGroupedReactions(msg.id, 'agent_1');
    expect(grouped[0]).toMatchObject({
      emoji: ':pixerate-heart:',
      sticker: 'pixerate-heart',
      count: 1,
      hasReacted: true
    });

    await act(async () => {
      await result.current!.toggleStickerReaction(msg.id, 'pixerate-heart', 'agent_1');
    });
    expect(result.current?.messages[0].reactions).toHaveLength(0);
  });

  it('exposes anchor state and updateAnchor', async () => {
    const driver = new MemoryConversationDriver();
    await driver.createConversation({
      id: 'convo_anchor',
      entity: { id: 'doc_1', type: 'document' },
      anchor: {
        start: 1,
        end: 6,
        quote: { exact: 'world' },
        state: 'attached'
      }
    });

    const { result } = renderThread(driver, 'convo_anchor');
    expect(result.current?.anchor?.start).toBe(1);

    await act(async () => {
      await result.current!.updateAnchor({
        start: 10,
        end: 15,
        quote: { exact: 'world' },
        state: 'orphaned'
      });
    });
    expect(result.current?.anchor).toMatchObject({ start: 10, state: 'orphaned' });

    await act(async () => {
      await result.current!.updateAnchor(null);
    });
    expect(result.current?.anchor).toBeNull();
  });
});
