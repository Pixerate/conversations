import type { ConversationDriver } from '../drivers/ConversationDriver.js';
import type { Conversation, Message, ThreadTreeNode } from '../types.js';
import { ThreadTree } from '../core/ThreadTree.js';

export class ThreadStore {
  private driver: ConversationDriver;
  private conversationId: string;
  private unsubscribe?: () => void;

  public conversation = $state<Conversation | null>(null);
  public messages = $state<Message[]>([]);
  public loading = $state<boolean>(true);
  public error = $state<Error | null>(null);

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
        this.messages = msgs;
        this.loading = false;
        this.error = null;
      },
      (err) => {
        this.error = err;
        this.loading = false;
      }
    );
  }

  public async postReply(content: string, author: any, parentId?: string | null) {
    return this.driver.postMessage({
      conversationId: this.conversationId,
      author,
      content,
      parentId
    });
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
