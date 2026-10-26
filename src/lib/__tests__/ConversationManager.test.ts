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

  it('edits and deletes messages via ConversationManager', async () => {
    const driver = new MemoryConversationDriver();
    const manager = new ConversationManager({ driver });

    const convo = await manager.createConversation({
      entity: { id: 'task_7', type: 'task' }
    });

    const msg = await manager.postMessage({
      conversationId: convo.id,
      author: authorAlice,
      content: 'Original'
    });

    const edited = await manager.editMessage(msg.id, 'Edited text', {
      richContent: '<p>Edited with <span data-type="mention" data-id="user_bob">@Bob</span></p>'
    });
    expect(edited.content).toBe('Edited text');
    expect(edited.mentions).toContain('user_bob');

    const deleted = await manager.deleteMessage(msg.id);
    expect(deleted.status).toBe('deleted');
    expect(deleted.content).toBe('[This comment was deleted]');
  });

  it('manages emoji reactions and toggleReaction', async () => {
    const driver = new MemoryConversationDriver();
    const manager = new ConversationManager({ driver });

    const convo = await manager.createConversation({
      entity: { id: 'task_8', type: 'task' }
    });

    const msg = await manager.postMessage({
      conversationId: convo.id,
      author: authorAlice,
      content: 'Let us launch today!'
    });

    // Add reaction
    const withReaction = await manager.addReaction(msg.id, '🚀', 'user_bob', convo.id);
    expect(withReaction.reactions).toHaveLength(1);
    expect(withReaction.reactions[0].emoji).toBe('🚀');

    // Toggle off
    const toggledOff = await manager.toggleReaction(msg.id, '🚀', 'user_bob', convo.id);
    expect(toggledOff.reactions).toHaveLength(0);

    // Toggle on
    const toggledOn = await manager.toggleReaction(msg.id, '🚀', 'user_bob', convo.id);
    expect(toggledOn.reactions).toHaveLength(1);

    // Remove reaction directly
    const removed = await manager.removeReaction(msg.id, '🚀', 'user_bob', convo.id);
    expect(removed.reactions).toHaveLength(0);
  });

  it('toggleReaction removes an existing reaction even without a conversationId', async () => {
    const driver = new MemoryConversationDriver();
    const manager = new ConversationManager({ driver });
    const convo = await manager.createConversation({ entity: { id: 'task_toggle', type: 'task' } });
    const msg = await manager.postMessage({
      conversationId: convo.id,
      author: authorAlice,
      content: 'Toggle me'
    });
    const listSpy = vi.spyOn(driver, 'listMessages');

    const on = await manager.toggleReaction(msg.id, '👍', 'user_bob');
    expect(on.reactions).toHaveLength(1);

    const off = await manager.toggleReaction(msg.id, '👍', 'user_bob');
    expect(off.reactions).toHaveLength(0);

    // Toggling delegates to the driver rather than loading the whole thread
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('editMessage keeps richContent when only plain content changes', async () => {
    const driver = new MemoryConversationDriver();
    const manager = new ConversationManager({ driver });
    const convo = await manager.createConversation({ entity: { id: 'task_edit', type: 'task' } });
    const msg = await manager.postMessage({
      conversationId: convo.id,
      author: authorAlice,
      content: 'Hi Bob',
      richContent: '<p>Hi <span data-type="mention" data-id="user_bob">@Bob</span></p>'
    });

    const edited = await manager.editMessage(msg.id, 'Hi Bob!', { conversationId: convo.id });
    expect(edited.content).toBe('Hi Bob!');
    expect(edited.richContent).toContain('data-id="user_bob"');
    expect(edited.mentions).toEqual(['user_bob']);
  });

  it('postMessageOptimistic stages optimistic message and calls onSuccess', async () => {
    const driver = new MemoryConversationDriver();
    const manager = new ConversationManager({ driver });

    const convo = await manager.createConversation({
      entity: { id: 'task_9', type: 'task' }
    });

    const staged: any[] = [];
    const confirmedList: any[] = [];

    const msg = await manager.postMessageOptimistic(
      {
        conversationId: convo.id,
        author: authorAlice,
        content: 'Optimistic message content'
      },
      {
        onOptimistic: (opt) => staged.push(opt),
        onSuccess: (conf) => confirmedList.push(conf)
      }
    );

    expect(staged).toHaveLength(1);
    expect(staged[0].status).toBe('pending');
    expect(staged[0].content).toBe('Optimistic message content');

    expect(confirmedList).toHaveLength(1);
    expect(confirmedList[0].id).toBe(msg.id);
    expect(confirmedList[0].status).toBe('sent');
  });

  it('postMessageOptimistic triggers rollback on driver failure', async () => {
    const driver = new MemoryConversationDriver();
    vi.spyOn(driver, 'postMessage').mockRejectedValueOnce(new Error('Network offline'));
    const manager = new ConversationManager({ driver });

    const convo = await manager.createConversation({
      entity: { id: 'task_10', type: 'task' }
    });

    const staged: any[] = [];
    const rollbacks: string[] = [];

    await expect(
      manager.postMessageOptimistic(
        {
          conversationId: convo.id,
          author: authorAlice,
          content: 'Failing comment'
        },
        {
          onOptimistic: (opt) => staged.push(opt),
          onRollback: (_err, tempId) => rollbacks.push(tempId)
        }
      )
    ).rejects.toThrow('Network offline');

    expect(staged).toHaveLength(1);
    expect(rollbacks).toHaveLength(1);
    expect(rollbacks[0]).toBe(staged[0].id);
  });

  it('subscribes to entity conversations', async () => {
    const driver = new MemoryConversationDriver();
    const manager = new ConversationManager({ driver });
    const entityHook = vi.fn();

    const unsub = manager.subscribeToEntityConversations('doc_42', entityHook);
    expect(entityHook).toHaveBeenCalledWith([]);

    const c1 = await manager.createConversation({
      entity: { id: 'doc_42', type: 'document', title: 'Specs' }
    });

    expect(entityHook).toHaveBeenLastCalledWith([c1]);
    unsub();
  });
});
