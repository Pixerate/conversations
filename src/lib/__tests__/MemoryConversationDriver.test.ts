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

  it('updates and deletes messages', async () => {
    const driver = new MemoryConversationDriver();
    const conv = await driver.createConversation({
      entity: { id: 'task-update-1', type: 'task' }
    });

    const msg = await driver.postMessage({
      conversationId: conv.id,
      content: 'Original content',
      author: { id: 'user-1', name: 'Jack', type: 'user' }
    });

    const updated = await driver.updateMessage(msg.id, { content: 'Edited content' });
    expect(updated.content).toBe('Edited content');
    expect(updated.updatedAt).toBeDefined();

    const deleted = await driver.deleteMessage(msg.id);
    expect(deleted.status).toBe('deleted');
    expect(deleted.content).toBe('[This comment was deleted]');
  });

  it('adds, deduplicates, and removes reactions', async () => {
    const driver = new MemoryConversationDriver();
    const conv = await driver.createConversation({
      entity: { id: 'task-react-1', type: 'task' }
    });

    const msg = await driver.postMessage({
      conversationId: conv.id,
      content: 'Great progress!',
      author: { id: 'user-1', name: 'Jack', type: 'user' }
    });

    // Add reaction
    const withReaction = await driver.addReaction(msg.id, { emoji: '👍', userId: 'user-2' });
    expect(withReaction.reactions).toHaveLength(1);
    expect(withReaction.reactions[0].emoji).toBe('👍');
    expect(withReaction.reactions[0].userId).toBe('user-2');

    // Duplicate add does not create second reaction
    const withDuplicate = await driver.addReaction(msg.id, { emoji: '👍', userId: 'user-2' });
    expect(withDuplicate.reactions).toHaveLength(1);

    // Remove reaction
    const afterRemove = await driver.removeReaction(msg.id, '👍', 'user-2');
    expect(afterRemove.reactions).toHaveLength(0);
  });

  it('subscribes to entity conversations and receives real-time updates', async () => {
    const driver = new MemoryConversationDriver();
    const entityListener = vi.fn();

    const unsubscribe = driver.subscribeToEntityConversations('project-xyz', entityListener);
    expect(entityListener).toHaveBeenCalledWith([]);

    const conv1 = await driver.createConversation({
      entity: { id: 'project-xyz', type: 'project', title: 'Roadmap' }
    });

    expect(entityListener).toHaveBeenLastCalledWith([conv1]);

    await driver.updateConversationStatus(conv1.id, 'resolved');
    expect(entityListener).toHaveBeenLastCalledWith([expect.objectContaining({ id: conv1.id, status: 'resolved' })]);

    unsubscribe();

    await driver.createConversation({
      entity: { id: 'project-xyz', type: 'project', title: 'Sprint 2' }
    });
    // Should not receive further notifications after unsubscribe
    expect(entityListener).toHaveBeenCalledTimes(3);
  });
});
