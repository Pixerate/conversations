import { describe, it, expect, vi } from 'vitest';
import { ConversationManager } from '../core/ConversationManager.js';
import { MemoryConversationDriver } from '../drivers/MemoryConversationDriver.js';

describe('ConversationManager', () => {
  const authorAlice = { type: 'user' as const, id: 'user_alice', name: 'Alice Smith', email: 'alice@example.com' };
  const authorBob = { type: 'user' as const, id: 'user_bob', name: 'Bob Jones', email: 'bob@example.com' };

  it('creates and retrieves conversations', async () => {
    const driver = new MemoryConversationDriver();
    const manager = new ConversationManager({ driver });

    const convo = await manager.createConversation({
      entity: { id: 'task_1', type: 'task', title: 'Test Task' }
    });

    expect(convo.id).toBeDefined();
    expect(convo.status).toBe('open');
    expect(convo.entity.id).toBe('task_1');

    const fetched = await manager.getConversation(convo.id);
    expect(fetched?.id).toBe(convo.id);
  });

  it('getOrCreateConversation returns existing without creating duplicate', async () => {
    const driver = new MemoryConversationDriver();
    const manager = new ConversationManager({ driver });

    const res1 = await manager.getOrCreateConversation({
      entity: { id: 'canvas_node_99', type: 'canvas_node' }
    });
    expect(res1.created).toBe(true);

    const res2 = await manager.getOrCreateConversation({
      entity: { id: 'canvas_node_99', type: 'canvas_node' }
    });
    expect(res2.created).toBe(false);
    expect(res2.conversation.id).toBe(res1.conversation.id);
  });

  it('posts root and reply messages and updates conversation metadata', async () => {
    const driver = new MemoryConversationDriver();
    const manager = new ConversationManager({ driver });

    const convo = await manager.createConversation({
      entity: { id: 'task_2', type: 'task' }
    });

    const msg1 = await manager.postMessage({
      conversationId: convo.id,
      author: authorAlice,
      content: 'First comment'
    });

    const msg2 = await manager.postMessage({
      conversationId: convo.id,
      parentId: msg1.id,
      author: authorBob,
      content: 'Reply comment'
    });

    const updatedConvo = await manager.getConversation(convo.id);
    expect(updatedConvo?.messageCount).toBe(2);
    expect(updatedConvo?.participantIds).toContain('user_alice');
    expect(updatedConvo?.participantIds).toContain('user_bob');

    const tree = await manager.getThreadTree(convo.id);
    expect(tree).toHaveLength(1);
    expect(tree[0].message.id).toBe(msg1.id);
    expect(tree[0].children[0].message.id).toBe(msg2.id);
  });

  it('automatically extracts mention IDs from richContent HTML', async () => {
    const driver = new MemoryConversationDriver();
    const manager = new ConversationManager({ driver });

    const convo = await manager.createConversation({
      entity: { id: 'task_3', type: 'task' }
    });

    const html = '<p>Hey <span data-type="mention" data-id="user_bob">@Bob</span> and <span data-type="mention" data-mention-id="user_charlie">@Charlie</span> please review!</p>';

    const msg = await manager.postMessage({
      conversationId: convo.id,
      author: authorAlice,
      content: 'Hey @Bob and @Charlie please review!',
      richContent: html
    });

    expect(msg.mentions).toContain('user_bob');
    expect(msg.mentions).toContain('user_charlie');
  });

  it('invokes onMessagePosted callback', async () => {
    const driver = new MemoryConversationDriver();
    const hook = vi.fn();
    const manager = new ConversationManager({ driver, onMessagePosted: hook });

    const convo = await manager.createConversation({
      entity: { id: 'task_4', type: 'task' }
    });

    const msg = await manager.postMessage({
      conversationId: convo.id,
      author: authorAlice,
      content: 'Hello'
    });

    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(msg, expect.objectContaining({ id: convo.id }));
  });

  it('resolves and reopens conversations', async () => {
    const driver = new MemoryConversationDriver();
    const manager = new ConversationManager({ driver });

    const convo = await manager.createConversation({
      entity: { id: 'task_5', type: 'task' }
    });

    const resolved = await manager.resolveConversation(convo.id, 'user_alice');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedBy).toBe('user_alice');
    expect(resolved.resolvedAt).toBeDefined();

    const reopened = await manager.reopenConversation(convo.id);
    expect(reopened.status).toBe('open');
  });

  it('exports conversation transcript', async () => {
    const driver = new MemoryConversationDriver();
    const manager = new ConversationManager({ driver });

    const convo = await manager.createConversation({
      entity: { id: 'task_6', type: 'task', title: 'Bug in Login' }
    });

    await manager.postMessage({
      conversationId: convo.id,
      author: authorAlice,
      content: 'We need to fix oauth tokens.'
    });

    const md = await manager.exportTranscript(convo.id);
    expect(md).toContain('# Conversation: Bug in Login');
    expect(md).toContain('Alice Smith');
    expect(md).toContain('We need to fix oauth tokens.');
  });
});
