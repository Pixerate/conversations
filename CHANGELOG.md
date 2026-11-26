# @pixerate/conversations

## 0.3.0

### Minor Changes

- 383a39e: feat: add `TextAnchorSchema`, text-range re-anchoring and entity thread helpers, Markdown transcript anchor context, JSON Schema exports, wire schema docs, and the `ConversationsKit` Swift package

## 0.2.0

### Minor Changes

- 90f55d5: Fix the Firestore driver for the modular `firebase/firestore` SDK, and run message posts, edits and reactions in transactions so concurrent writes are not lost. Strip `undefined` values at every depth before writing. Gate the first conversation update until messages have loaded, and cancel snapshot listeners that are unsubscribed before they attach. Add `toggleReaction` to the `ConversationDriver` interface (custom drivers must implement it). Keep `richContent` and re-harvest mentions on edits in the Svelte and React wrappers via the new `buildMessageEdit` helper. Scope the React `useThread` cache per driver and evict idle subscribers. Keep replies below a parent cycle attached in `ThreadTree`.
- 501b06b: Support flat `authorId` property in `reconcileOptimisticMessages` and add `ThreadTree.buildCommentThreads` for self-nesting threaded comment trees.
- 1f16980: Add `StickerProvider` support for inline message stickers and sticker reactions, including `:id:` (single-pack) and `:pack-id:` (multi-pack) shortcode formatting/parsing, HTML token extraction, `resolveSticker` / `resolveMessageStickers` helpers, agent sticker tools (`createMessageStickerTools`), and integration across `ConversationManager`, Svelte 5 `ThreadStore`, and React 19 `useThread`.
  
  `ConversationDriver.removeReaction` now takes a `ReactionInput` instead of an emoji string, so custom drivers must accept `{ emoji, sticker }` to remove the right reaction.
- a009766: Implement optimistic message reconciliation, emoji reactions, message editing, soft deletion, and code block shielding in mention extraction.

### Patch Changes

- 4e5476a: Accept firebase v13 as a peer dependency (`^10 || ^11 || ^12 || ^13`). Dev dependency moved to firebase 13 so the test suite runs against it.
- 8a0e342: chore: open-source `@pixerate/conversations` under the MIT license with public npm OIDC provenance publishing
