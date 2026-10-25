import { describe, it, expect, vi } from 'vitest';
import { MemoryConversationDriver } from '../drivers/MemoryConversationDriver.js';

describe('MemoryConversationDriver', () => {
  it('creates and retrieves conversations by ID and entity', async () => {
    const driver = new MemoryConversationDriver();
    const created = await driver.createConversation({
      entity: { id: 'card-1', type: 'card', title: 'Task Card' }
    });

    expect(created.id).toBeDefined();
    expect(created.status).toBe('open');

    const fetched = await driver.getConversation(created.id);
    expect(fetched).toEqual(created);

    const byEntity = await driver.getConversationByEntity('card-1', 'card');
    expect(byEntity).toEqual(created);
  });

  it('posts and retrieves messages', async () => {
    const driver = new MemoryConversationDriver();
    const conv = await driver.createConversation({
      entity: { id: 'card-2', type: 'card' }
    });

    const msg = await driver.postMessage({
      conversationId: conv.id,
      content: 'First message',
      author: { id: 'user-1', name: 'Jack', type: 'user' }
    });

    expect(msg.id).toBeDefined();
    expect(msg.content).toBe('First message');

    const messages = await driver.listMessages(conv.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(msg.id);
  });

  it('updates conversation status', async () => {
    const driver = new MemoryConversationDriver();
    const conv = await driver.createConversation({
      entity: { id: 'doc-1', type: 'doc' }
    });

    const updated = await driver.updateConversationStatus(conv.id, 'resolved', 'user-2');
    expect(updated.status).toBe('resolved');
    expect(updated.resolvedBy).toBe('user-2');
    expect(updated.resolvedAt).toBeDefined();
  });

  it('notifies subscribers on conversation updates and supports unsubscribe', async () => {
    const driver = new MemoryConversationDriver();
    const conv = await driver.createConversation({
      entity: { id: 'task-1', type: 'task' }
    });

    const listener = vi.fn();
    const unsubscribe = driver.subscribeToConversation(conv.id, listener);

    await driver.postMessage({
      conversationId: conv.id,
      content: 'Hello subscriber',
      author: { id: 'user-1', name: 'Jack', type: 'user' }
    });

    expect(listener).toHaveBeenCalled();
    const callCount = listener.mock.calls.length;

    unsubscribe();

    await driver.postMessage({
      conversationId: conv.id,
      content: 'Another message',
      author: { id: 'user-1', name: 'Jack', type: 'user' }
    });

    expect(listener).toHaveBeenCalledTimes(callCount);
  });
});
