import type { Message } from '../types.js';

interface MessageLike {
  id: string;
  content: string;
  createdAt: string;
  author?: { id?: string };
  parentId?: string | null;
  children?: MessageLike[];
  replies?: MessageLike[];
}

function matchesMessage(opt: Message, server: MessageLike, windowMs: number): boolean {
  // 1. Direct ID match
  if (server.id === opt.id) {
    return true;
  }

  // 2. Fuzzy match: same author, same content, same parent, within time window
  const optAuthorId = opt.author?.id;
  const serverAuthorId = server.author?.id;

  if (optAuthorId && serverAuthorId && optAuthorId === serverAuthorId) {
    if (opt.content === server.content) {
      const optParent = opt.parentId ?? null;
      const serverParent = server.parentId ?? null;
      if (optParent === serverParent) {
        const timeOpt = new Date(opt.createdAt).getTime();
        const timeServer = new Date(server.createdAt).getTime();
        if (!isNaN(timeOpt) && !isNaN(timeServer)) {
          if (Math.abs(timeServer - timeOpt) <= windowMs) {
            return true;
          }
        }
      }
    }
  }

  // 3. Check nested children/replies if server item is a tree node
  if (Array.isArray(server.children)) {
    for (const child of server.children) {
      if (matchesMessage(opt, child, windowMs)) return true;
    }
  }
  if (Array.isArray(server.replies)) {
    for (const reply of server.replies) {
      if (matchesMessage(opt, reply, windowMs)) return true;
    }
  }

  return false;
}

/**
 * Reconciles optimistic messages against incoming server messages.
 * Uses exact ID match and fuzzy matching (content + author + parentId within windowMs timestamp)
 * to eliminate duplicates when snapshot listeners receive confirmed writes.
 * 
 * Returns the remaining unreconciled optimistic messages.
 * Preserves input array reference equality if no messages were reconciled.
 */
export function reconcileOptimisticMessages(
  optimisticList: Message[],
  serverList: MessageLike[],
  windowMs: number = 10_000
): Message[] {
  if (!optimisticList || optimisticList.length === 0) {
    return [];
  }
  if (!serverList || serverList.length === 0) {
    return optimisticList;
  }

  const remaining = optimisticList.filter(opt => {
    const isPresentOnServer = serverList.some(server => matchesMessage(opt, server, windowMs));
    return !isPresentOnServer;
  });

  // Preserve reference if no items were removed to prevent unnecessary reactive re-renders
  if (remaining.length === optimisticList.length) {
    return optimisticList;
  }

  return remaining;
}

/**
 * Combines server messages with remaining unreconciled optimistic messages.
 */
export function reconcileAndMergeMessages(
  optimisticList: Message[],
  serverList: Message[],
  windowMs: number = 10_000
): Message[] {
  const remainingOptimistic = reconcileOptimisticMessages(optimisticList, serverList, windowMs);
  if (remainingOptimistic.length === 0) {
    return serverList;
  }
  return [...serverList, ...remainingOptimistic];
}
