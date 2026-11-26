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

- Always sanitize documents before persisting to Firestore by stripping `undefined` values.
- The check is **recursive**: Firestore rejects `undefined` at any depth, so a top-level-only strip still fails on e.g. `entity.title`, `author.avatarUrl`, or `metadata.*`.
- `sanitizeDocument` in `FirestoreConversationDriver` recurses into plain objects and arrays (dropping `undefined` array items) and passes non-plain values (Timestamps, `FieldValue` sentinels) through untouched.

---

## 2. Cyclic Parent-Child Relationships in Thread Trees

### ⚠️ Gotcha

If malicious or malformed message data introduces a cycle (e.g., Message A has `parentId: 'B'` and Message B has `parentId: 'A'`), recursive tree-building algorithms will cause a stack overflow (`RangeError: Maximum call stack size exceeded`) or infinite loop when rendering or flattening the tree.

### ✅ Solution

- In `ThreadTree.buildTree()`, maintain an active `visited` or `ancestors` Set during tree traversal.
- If a cycle is detected, break the cycle by treating the cyclic child as an orphan and attaching it to the root level with a warning flag, preventing recursion crashes.
- Only messages **on** the cycle are promoted: the ancestor walk counts as a cycle only when it returns to the message it started from. A reply hanging below a cycle (C → A, with A ↔ B) revisits A rather than C, and must stay attached to A, which is now a root.

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
- Keep the summary consistent with concurrent writers: never read the conversation, add 1 and write it back outside a transaction (two posts at once both write the same count). `FirestoreConversationDriver.postMessage` writes the message and the summary in one transaction, which retries on contention. See [Gotcha 7](#7-firestore-read-modify-write-must-run-in-a-transaction).

---

## 5. React 19 `useSyncExternalStore` and Svelte 5 `$state` Interop

### ⚠️ Gotcha

- In React 19, reading mutable state without a deterministic snapshot causes hydration mismatches or infinite re-renders with `useSyncExternalStore`.
- In Svelte 5, mutating `$state` arrays directly from inside asynchronous callbacks can produce untracked state or race conditions if not cleanly encapsulated in class signals.

### ✅ Solution

- For React: `ConversationManager` and `ThreadStore` expose an immutable snapshot getter `getSnapshot()` that returns a cached object reference whenever state hasn't changed.
- For Svelte 5: Encapsulate reactive state in a rune class with `$state` properties and `$derived` getters, exposing clean methods for actions.

---

## 6. Optimistic Message Reconciliation Reference Stability

### ⚠️ Gotcha

When reconciling optimistic messages against real-time server snapshots in Svelte 5 runes (`$state`) or React 19 external stores (`useSyncExternalStore`), generating a new array reference on every snapshot — even when no optimistic messages were matched or removed — triggers unnecessary reactive cascade updates and can cause infinite re-render cycles or flickering input elements.

### ✅ Solution

- In `reconcileOptimisticMessages`, compare the remaining list length against the incoming list length. If no optimistic messages were reconciled, return the exact same array reference:
  ```ts
  if (remaining.length === optimisticMessages.length) {
    return optimisticMessages;
  }
  ```
- Similarly, in `reconcileAndMergeMessages`, if `optimisticMessages.length === 0`, return `serverMessages` directly to preserve referential equality.

---

## 7. Firestore Read-Modify-Write Must Run in a Transaction

### ⚠️ Gotcha

Reading a document, changing an array or counter in memory, then `set`ting the whole document back loses concurrent writes: two users reacting at the same moment both read `reactions: []`, and the second write erases the first. The same applies to edits racing reactions, and to `messageCount`/`participantIds`.

### ✅ Solution

- Wrap every read-modify-write in `runTransaction` (Admin: `db.runTransaction(fn)`; modular: `runTransaction(db, fn)`). Both expose the same `tx.get` / `tx.set` / `tx.update` shape.
- Do all `tx.get` calls before any write (the Admin SDK enforces this).
- The transaction callback may run more than once on contention, so it must be pure: compute updates only from what it read (see `mutateMessage`).
- Client-SDK transactions need a server round trip and fail while offline.
- Tests: `src/lib/__tests__/fakes/fakeFirestore.ts` yields between reads and retries stale transactions, so `Promise.all` of concurrent writes reproduces lost updates.

---

## 8. Modular Firestore SDK Needs Its Own References

### ⚠️ Gotcha

The modular SDK (`firebase/firestore`) only accepts references built by its own `doc()`, `collection()` and `query(..., where(), orderBy())` functions. Passing hand-built objects such as `{ path, db }` to `getDoc`/`onSnapshot` throws, and filters stored on them are silently ignored. Mocks shaped like the Admin SDK never exercise this path.

### ✅ Solution

- `FirestoreConversationDriver` picks an adapter once (Admin when `db.collection` is a function, otherwise modular via a lazy `import('firebase/firestore')`) and builds every ref and query through it from path strings.
- Driver tests run against both flavours: `createAdminDb()` and `createModularDb()` with `vi.mock('firebase/firestore')` mapped to the same fake store.

---

## 9. Snapshot Listeners That Attach Asynchronously

### ⚠️ Gotcha

When a listener can only be attached after an async step (such as the lazy SDK import), an unsubscribe function that captures "the current unsub" calls a no-op if it runs first, and the listener attaches afterwards with nothing able to remove it. React StrictMode's mount/unmount/mount triggers this on every page.

Separately, a conversation subscription built from two listeners (conversation document + messages query) can emit the conversation before the messages arrive, briefly rendering an empty thread.

### ✅ Solution

- Set a `cancelled` flag on unsubscribe and skip attaching once the async step resolves (`FirestoreConversationDriver.listen`).
- Hold back the first `onUpdate` until both the conversation and messages listeners have delivered at least once.

---

## 10. Dash-Namespaced Sticker Shortcodes with Hyphenated Pack IDs

### ⚠️ Gotcha

Message sticker shortcodes use bare `:id:` when a single sticker pack is active (e.g. `:heart:` or `:paint-bucket:`) and dash-namespaced `:pack-id:` when multiple packs are provided (e.g. `:pixerate-heart:` or `:studio-pack-paint-bucket:`). Because both the pack ID (`studio-pack`) and the sticker ID (`paint-bucket`) can contain hyphens, splitting on the first `-` produces an invalid pack ID (`studio`).

Separately, `@pixerate/stickers` types `StickerDescription.variants` as `{ id: string; name: string }[]` whereas `@pixerate/editor/stickers` types it as `StickerVariant[]` (`('light' | 'dark')[]`).

### ✅ Solution

- When resolving against an array of `StickerProvider`s, sort providers by descending `id.length` before matching `${provider.id}-` prefixes so longer hyphenated pack IDs (`studio-pack`) always match first.
- When resolving a dash-namespaced shortcode against a pre-combined `namespaced: true` provider that expects `provider:id` refs, test candidate `-` → `:` split positions from longest prefix to shortest.
- A sticker id that begins with its own pack id (`logo` vs `pixerate-logo` in pack `pixerate`) is ambiguous in single-pack mode: `formatStickerShortcode` strips the prefix so `:pixerate-heart:` and `:heart:` stay one reaction. Avoid pack-prefixed sticker ids.
- Type `StickerDescription.variants` structurally as `StickerVariant[] | Array<{ id: string; name: string }>` so providers from both `@pixerate/stickers` and `@pixerate/editor/stickers` are assignable without casts.

---

## 11. Public npm Provenance & OIDC Requires GitHub-Hosted Runners

### ⚠️ Gotcha

Publishing to public npm with `NPM_CONFIG_PROVENANCE: "true"` and npm Trusted Publishing (OIDC `id-token: write`) fails when `.github/workflows/release.yml` runs on a `self-hosted` runner, because npm's Sigstore provenance verifier checks that the OIDC token's `runner_environment` claim is `"github-hosted"`. Additionally, running `pull_request` workflows on a local `self-hosted` runner on a public repository exposes the runner to untrusted fork pull requests.

### ✅ Solution

- Always run `.github/workflows/release.yml` and `.github/workflows/test.yml` on `ubuntu-latest` (GitHub-hosted runners) for public repositories.
