# Technical Gotchas & Workarounds

This document tracks known technical gotchas, edge cases, library quirks, and platform-specific workarounds encountered in `@pixerate/conversations`.

All AI agents and developers **MUST** check this document before starting work and update it whenever a new gotcha is discovered and resolved.

---

## 1. Firestore `undefined` Field Values in Document Writes

### ⚠️ Gotcha

Passing JavaScript objects containing fields with `undefined` values to Cloud Firestore write operations (`setDoc`, `updateDoc`, or Admin SDK `docRef.set()`) throws a runtime error:
`FirebaseError: Function setDoc() called with invalid data. Unsupported field value: undefined`.

Optional conversation/message properties (such as `parentId`, `richContent`, `updatedAt`, or `metadata`) that default to `undefined` trigger this error when writing message documents directly.

### ✅ Solution

- Always sanitize documents before persisting to Firestore by stripping keys with `undefined` values.
- In `FirestoreConversationDriver`, iterate through record entries and only include defined values:
  ```ts
  const docData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      docData[key] = value;
    }
  }
  await setDoc(docRef, docData);
  ```

---

## 2. Cyclic Parent-Child Relationships in Thread Trees

### ⚠️ Gotcha

If malicious or malformed message data introduces a cycle (e.g., Message A has `parentId: 'B'` and Message B has `parentId: 'A'`), recursive tree-building algorithms will cause a stack overflow (`RangeError: Maximum call stack size exceeded`) or infinite loop when rendering or flattening the tree.

### ✅ Solution

- In `ThreadTree.buildTree()`, maintain an active `visited` or `ancestors` Set during tree traversal.
- If a cycle is detected, break the cycle by treating the cyclic child as an orphan and attaching it to the root level with a warning flag, preventing recursion crashes.

---

## 3. Orphan Messages When Parent Comments Are Deleted

### ⚠️ Gotcha

When a user deletes a parent comment in a threaded discussion, child replies whose `parentId` references the deleted comment can disappear entirely from the UI if the tree builder assumes every `parentId` exists in the current message set.

### ✅ Solution

- If a message's `parentId` is not found in the message map, the tree builder should either:
  1. Synthesize a placeholder parent (`isDeleted: true`, content: *"This comment was deleted"*), or
  2. Promote the orphan message to the root level while preserving `parentId` in metadata.
- `ThreadTree.buildTree()` provides an `orphanStrategy: 'root' | 'placeholder'` option defaulting to `'placeholder'` to ensure reply context is never silently lost.

---

## 4. Firestore Subcollection vs Root Collection Queries

### ⚠️ Gotcha

Querying messages across subcollections (e.g. `collectionGroup('messages')`) requires composite Collection Group indexes in Firestore. Furthermore, counting total messages for an entity by querying all subcollection messages incurs high read costs ($O(N)$ document reads).

### ✅ Solution

- Keep lightweight summary metadata directly on the parent conversation document:
  `messageCount`, `lastMessageAt`, `participantIds`, `status`.
- Atomic increments: use `FieldValue.increment(1)` when writing a new message to `conversations/{id}/messages/{messageId}` to update `messageCount` on the parent without extra reads.

---

## 5. React 19 `useSyncExternalStore` and Svelte 5 `$state` Interop

### ⚠️ Gotcha

- In React 19, reading mutable state without a deterministic snapshot causes hydration mismatches or infinite re-renders with `useSyncExternalStore`.
- In Svelte 5, mutating `$state` arrays directly from inside asynchronous callbacks can produce untracked state or race conditions if not cleanly encapsulated in class signals.

### ✅ Solution

- For React: `ConversationManager` and `ThreadStore` expose an immutable snapshot getter `getSnapshot()` that returns a cached object reference whenever state hasn't changed.
- For Svelte 5: Encapsulate reactive state in a rune class with `$state` properties and `$derived` getters, exposing clean methods for actions.
