import { useSyncExternalStore, useMemo, useCallback } from 'react';
import type { ConversationDriver } from '../drivers/ConversationDriver.js';
import type { Conversation, Message, ThreadTreeNode } from '../types.js';
import { ThreadTree } from '../core/ThreadTree.js';

export interface ThreadState {
  conversation: Conversation | null;
  messages: Message[];
  tree: ThreadTreeNode[];
  loading: boolean;
  error: Error | null;
}

class ThreadStoreSubscriber {
  private driver: ConversationDriver;
  private conversationId: string;
  private state: ThreadState;
  private listeners = new Set<() => void>();
  private unsubscribeDriver?: () => void;

  constructor(driver: ConversationDriver, conversationId: string) {
    this.driver = driver;
    this.conversationId = conversationId;
    this.state = {
      conversation: null,
      messages: [],
      tree: [],
      loading: true,
      error: null
    };
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    if (this.listeners.size === 1) {
      this.unsubscribeDriver = this.driver.subscribeToConversation(
        this.conversationId,
        (convo, msgs) => {
          this.state = {
            conversation: convo,
            messages: msgs,
            tree: ThreadTree.buildTree(msgs),
            loading: false,
            error: null
          };
          this.notify();
        },
        (err) => {
          this.state = {
            ...this.state,
            loading: false,
            error: err
          };
          this.notify();
        }
      );
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.unsubscribeDriver) {
        this.unsubscribeDriver();
        this.unsubscribeDriver = undefined;
      }
    };
  };

  public getSnapshot = (): ThreadState => {
    return this.state;
  };

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public postMessage = async (content: string, author: any, parentId?: string | null) => {
    return this.driver.postMessage({
      conversationId: this.conversationId,
      author,
      content,
      parentId
    });
  };

  public resolve = async (resolvedBy?: string) => {
    return this.driver.updateConversationStatus(this.conversationId, 'resolved', resolvedBy);
  };

  public reopen = async () => {
    return this.driver.updateConversationStatus(this.conversationId, 'open');
  };
}

const subscriberCache = new Map<string, ThreadStoreSubscriber>();

/**
 * React 19 hook for reactive, flicker-free conversation thread synchronization.
 */
export function useThread(driver: ConversationDriver, conversationId: string) {
  const cacheKey = `${conversationId}`;

  const subscriber = useMemo(() => {
    let sub = subscriberCache.get(cacheKey);
    if (!sub) {
      sub = new ThreadStoreSubscriber(driver, conversationId);
      subscriberCache.set(cacheKey, sub);
    }
    return sub;
  }, [driver, conversationId, cacheKey]);

  const state = useSyncExternalStore(
    subscriber.subscribe,
    subscriber.getSnapshot,
    subscriber.getSnapshot
  );

  const postMessage = useCallback(
    (content: string, author: any, parentId?: string | null) => {
      return subscriber.postMessage(content, author, parentId);
    },
    [subscriber]
  );

  const resolve = useCallback(
    (resolvedBy?: string) => {
      return subscriber.resolve(resolvedBy);
    },
    [subscriber]
  );

  const reopen = useCallback(() => {
    return subscriber.reopen();
  }, [subscriber]);

  return {
    ...state,
    totalCount: state.messages.length,
    isResolved: state.conversation?.status === 'resolved',
    postMessage,
    resolve,
    reopen
  };
}
