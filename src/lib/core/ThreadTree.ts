import type { Message, ThreadTreeNode, ThreadTreeOptions } from '../types.js';

export class ThreadTree {
  /**
   * Builds a hierarchical tree from a flat array of messages.
   * Handles cycles gracefully by breaking infinite loops and mounting cyclic nodes at the root.
   * Handles missing parent IDs via the configured orphanStrategy.
   */
  public static buildTree(messages: Message[], options: ThreadTreeOptions = {}): ThreadTreeNode[] {
    const orphanStrategy = options.orphanStrategy ?? 'placeholder';

    if (!Array.isArray(messages) || messages.length === 0) {
      return [];
    }

    // Sort messages chronologically by createdAt (ascending)
    const sorted = [...messages].sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      return timeA - timeB;
    });

    const messageMap = new Map<string, Message>();
    for (const msg of sorted) {
      messageMap.set(msg.id, msg);
    }

    // Cycle detection: identify if node belongs to a cycle
    const safeParentMap = new Map<string, string | null>();
    for (const msg of sorted) {
      if (!msg.parentId) {
        safeParentMap.set(msg.id, null);
        continue;
      }

      // Traverse ancestors to check for loops. Only a walk that returns to this message
      // means it sits on a cycle; revisiting some other ancestor means the cycle lies
      // further up, and this message stays attached to its (intact) parent.
      let currParent: string | null | undefined = msg.parentId;
      const seen = new Set<string>([msg.id]);
      let isCycle = false;

      while (currParent) {
        if (seen.has(currParent)) {
          isCycle = currParent === msg.id;
          break;
        }
        seen.add(currParent);
        const parentMsg = messageMap.get(currParent);
        currParent = parentMsg?.parentId;
      }

      if (isCycle) {
        // Break cycle: treat as root
        safeParentMap.set(msg.id, null);
      } else {
        safeParentMap.set(msg.id, msg.parentId);
      }
    }

    // Group children by parent ID
    const childrenMap = new Map<string, Message[]>();
    const rootMessages: Message[] = [];
    const syntheticParents = new Map<string, Message>();

    for (const msg of sorted) {
      const parentId = safeParentMap.get(msg.id);

      if (!parentId) {
        rootMessages.push(msg);
      } else if (messageMap.has(parentId)) {
        const existing = childrenMap.get(parentId) || [];
        existing.push(msg);
        childrenMap.set(parentId, existing);
      } else {
        // Parent is missing
        if (orphanStrategy === 'root') {
          rootMessages.push(msg);
        } else {
          // Synthetic placeholder parent
          if (!syntheticParents.has(parentId)) {
            const placeholder: Message = {
              id: parentId,
              conversationId: msg.conversationId,
              author: {
                id: 'system',
                name: 'Deleted Comment',
                type: 'system'
              },
              content: '[This comment was deleted]',
              status: 'deleted',
              mentions: [],
              attachments: [],
              reactions: [],
              createdAt: msg.createdAt
            };
            syntheticParents.set(parentId, placeholder);
            rootMessages.push(placeholder);
          }
          const existing = childrenMap.get(parentId) || [];
          existing.push(msg);
          childrenMap.set(parentId, existing);
        }
      }
    }

    function buildSubtree(msg: Message, depth: number): ThreadTreeNode {
      const children = childrenMap.get(msg.id) || [];
      return {
        message: msg,
        depth,
        isSyntheticParent: syntheticParents.has(msg.id),
        children: children.map(child => buildSubtree(child, depth + 1))
      };
    }

    return rootMessages.map(rootMsg => buildSubtree(rootMsg, 0));
  }

  /**
   * Flattens a thread tree into display order (depth-first pre-order traversal)
   * preserving visual hierarchy for linear feeds.
   */
  public static flattenTree(nodes: ThreadTreeNode[]): Message[] {
    const result: Message[] = [];

    function traverse(node: ThreadTreeNode) {
      result.push(node.message);
      for (const child of node.children) {
        traverse(child);
      }
    }

    for (const node of nodes) {
      traverse(node);
    }

    return result;
  }

  /**
   * Recursively counts all descendant replies under a node.
   */
  public static countDescendants(node: ThreadTreeNode): number {
    let count = node.children.length;
    for (const child of node.children) {
      count += this.countDescendants(child);
    }
    return count;
  }

  /**
   * Finds a node by message ID within a thread tree.
   */
  public static findNode(nodes: ThreadTreeNode[], messageId: string): ThreadTreeNode | null {
    for (const node of nodes) {
      if (node.message.id === messageId) return node;
      const found = this.findNode(node.children, messageId);
      if (found) return found;
    }
    return null;
  }
}

export const buildThreadTree = ThreadTree.buildTree.bind(ThreadTree);
export const flattenTree = ThreadTree.flattenTree.bind(ThreadTree);
export const countDescendants = ThreadTree.countDescendants.bind(ThreadTree);
export const findNodeInTree = ThreadTree.findNode.bind(ThreadTree);

