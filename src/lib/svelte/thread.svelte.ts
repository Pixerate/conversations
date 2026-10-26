import type { ConversationDriver } from '../drivers/ConversationDriver.js';
import type { Conversation, Message, ThreadTreeNode, GroupedReaction } from '../types.js';
import { ThreadTree } from '../core/ThreadTree.js';
import { reconcileOptimisticMessages, reconcileAndMergeMessages } from '../core/reconciliation.js';
import { groupReactions } from '../core/reactions.js';
import { buildMessageEdit } from '../core/messageEdits.js';

export class ThreadStore {
  private driver: ConversationDriver;
  private conversationId: string;
  private unsubscribe?: () => void;

  public conversation = $state<Conversation | null>(null);
  public serverMessages = $state<Message[]>([]);
  public optimisticMessages = $state<Message[]>([]);
  public loading = $state<boolean>(true);
  public error = $state<Error | null>(null);

  public messages = $derived<Message[]>(
    reconcileAndMergeMessages(this.optimisticMessages, this.serverMessages)
  );
  public tree = $derived<ThreadTreeNode[]>(ThreadTree.buildTree(this.messages));
  public totalCount = $derived<number>(this.messages.length);
  public isResolved = $derived<boolean>(this.conversation?.status === 'resolved');

  constructor(driver: ConversationDriver, conversationId: string) {
    this.driver = driver;
    this.conversationId = conversationId;
    this.init();
  }

  private init() {
    this.loading = true;
    this.unsubscribe = this.driver.subscribeToConversation(
      this.conversationId,
      (convo, msgs) => {
        this.conversation = convo;
        this.serverMessages = msgs;
        this.optimisticMessages = reconcileOptimisticMessages(this.optimisticMessages, msgs);
        this.loading = false;
        this.error = null;
      },
      (err) => {
        this.error = err;
        this.loading = false;
      }
    );
  }

  public async postReply(
    content: string,
    author: any,
    parentId?: string | null,
    richContent?: string
  ): Promise<Message> {
    const tempId = `temp_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const optimisticMsg: Message = {
      id: tempId,
      conversationId: this.conversationId,
      author,
      content,
      richContent,
      parentId: parentId || null,
      status: 'pending',
      mentions: [],
      attachments: [],
      reactions: [],
      createdAt: new Date().toISOString()
    };

    this.optimisticMessages = [...this.optimisticMessages, optimisticMsg];

    try {
      const confirmed = await this.driver.postMessage({
        conversationId: this.conversationId,
        author,
        content,
        richContent,
        parentId
      });
      return confirmed;
    } catch (err: any) {
      this.optimisticMessages = this.optimisticMessages.filter(m => m.id !== tempId);
      this.error = err;
      throw err;
    }
  }

  public async editMessage(messageId: string, content: string, richContent?: string) {
    return this.driver.updateMessage(
      messageId,
      buildMessageEdit(content, richContent),
      this.conversationId
    );
  }

  public async deleteMessage(messageId: string) {
    return this.driver.deleteMessage(messageId, this.conversationId);
  }

  public async addReaction(messageId: string, emoji: string, userId: string) {
    return this.driver.addReaction(messageId, { emoji, userId }, this.conversationId);
  }

  public async removeReaction(messageId: string, emoji: string, userId: string) {
    return this.driver.removeReaction(messageId, emoji, userId, this.conversationId);
  }

  public async toggleReaction(messageId: string, emoji: string, userId: string) {
    return this.driver.toggleReaction(messageId, { emoji, userId }, this.conversationId);
  }

  public getGroupedReactions(
    messageId: string,
    currentUserId?: string,
    nameResolver?: (userId: string) => string
  ): GroupedReaction[] {
    const msg = this.messages.find(m => m.id === messageId);
    return groupReactions(msg?.reactions || [], currentUserId, nameResolver);
  }

  public async resolve(resolvedBy?: string) {
    return this.driver.updateConversationStatus(this.conversationId, 'resolved', resolvedBy);
  }

  public async reopen() {
    return this.driver.updateConversationStatus(this.conversationId, 'open');
  }

  public destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }
}

/**
 * Creates a reactive Svelte 5 store for a conversation thread.
 */
export function createThreadStore(
  driver: ConversationDriver,
  conversationId: string
): ThreadStore {
  return new ThreadStore(driver, conversationId);
}
