# `@pixerate/conversations`

A UI-agnostic, headless conversation and comment-threading engine for Svelte 5, React 19, and Node.js on Google Cloud Platform.

---

## Features

- **UI-Agnostic Core**: Thread tree hierarchies, reply nesting, cycle detection, orphan recovery, and conversation lifecycle management completely decoupled from frontend frameworks.
- **Svelte 5 Runes**: First-class reactive stores powered by Svelte 5 `$state` and `$derived` signals (`@pixerate/conversations/svelte`).
- **React 19 Hooks**: Flicker-free reactive sync using `useSyncExternalStore` (`@pixerate/conversations/react`).
- **Flexible Storage Drivers**:
  - `MemoryConversationDriver` for ultra-fast, offline, deterministic unit tests and Storybook.
  - `FirestoreConversationDriver` for production Cloud Firestore with real-time snapshot synchronization (`@pixerate/conversations/gcp`).
- **Polymorphic Entity Attachment**: Attach threaded discussions to tasks, canvas nodes, video generations, prompt templates, or arbitrary entities.
- **Transcript Serialization**: Export conversation trees to structured Markdown for LLM prompt context or audit logs.
- **Deep Integration**: Bridges seamlessly with `@pixerate/editor` (rich text and mention tokens), `@pixerate/realtime` (ephemeral typing indicators), and `@pixerate/notifications` (mention fan-out and unread badges).

---

## Installation

```bash
npm install @pixerate/conversations @pixerate/schemas
```

Peer dependencies:
```bash
# Svelte apps
npm install svelte@^5.0.0

# React apps
npm install react@^19.0.0 react-dom@^19.0.0

# Firebase / Firestore apps
npm install firebase@^12.0.0 # or firebase-admin on the server
```

---

## Quick Start

### 1. Headless Core Usage

```typescript
import { ConversationManager, MemoryConversationDriver } from '@pixerate/conversations';

const driver = new MemoryConversationDriver();
const manager = new ConversationManager({ driver });

// Create a conversation attached to a task
const conversation = await manager.createConversation({
  entity: { id: 'task_123', type: 'task', title: 'Refactor Auth' }
});

// Post a root comment
const comment = await manager.postMessage({
  conversationId: conversation.id,
  author: { id: 'user_1', name: 'Alice Smith', email: 'alice@example.com' },
  content: 'Please review the new auth flow @bob.'
});

// Post a nested reply
const reply = await manager.postMessage({
  conversationId: conversation.id,
  parentId: comment.id,
  author: { id: 'user_2', name: 'Bob Jones', email: 'bob@example.com' },
  content: 'Looks great! Approved.'
});

// Retrieve threaded tree
const tree = await manager.getThreadTree(conversation.id);
console.log(tree[0].children[0].message.content); // 'Looks great! Approved.'
```

---

### 2. Svelte 5 (Runes)

```svelte
<script lang="ts">
  import { createThreadStore } from '@pixerate/conversations/svelte';
  import { FirestoreConversationDriver } from '@pixerate/conversations/gcp';
  import { db } from '$lib/firebase/client';

  const driver = new FirestoreConversationDriver({ db });
  const thread = createThreadStore(driver, 'convo_task_123');
</script>

<div>
  <h3>Comments ({thread.totalCount})</h3>

  {#if thread.loading}
    <p>Loading comments...</p>
  {:else}
    {#each thread.tree as rootNode}
      <div class="comment">
        <strong>{rootNode.message.author.name}</strong>
        <p>{rootNode.message.content}</p>

        <!-- Nested replies -->
        {#each rootNode.children as replyNode}
          <div class="reply pl-4">
            <strong>{replyNode.message.author.name}</strong>
            <p>{replyNode.message.content}</p>
          </div>
        {/each}
      </div>
    {/each}
  {/if}
</div>
```

---

### 3. React 19 (Hooks)

```tsx
import React from 'react';
import { useThread } from '@pixerate/conversations/react';
import { FirestoreConversationDriver } from '@pixerate/conversations/gcp';
import { db } from './firebaseClient';

const driver = new FirestoreConversationDriver({ db });

export function TaskComments({ conversationId }: { conversationId: string }) {
  const { tree, totalCount, loading, postMessage } = useThread(driver, conversationId);

  if (loading) return <div>Loading comments...</div>;

  return (
    <div>
      <h3>Comments ({totalCount})</h3>
      {tree.map(node => (
        <div key={node.message.id} className="comment">
          <strong>{node.message.author.name}</strong>
          <p>{node.message.content}</p>

          {node.children.map(reply => (
            <div key={reply.message.id} className="reply pl-4">
              <strong>{reply.message.author.name}</strong>
              <p>{reply.message.content}</p>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

---

## Development & Testing

```bash
# Type check and Svelte check
npm run check

# Run Vitest test suite
npm run test

# Build package
npm run build
```

---

## License

Private repository. Copyright © Pixerate. All rights reserved.
