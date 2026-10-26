---
'@pixerate/conversations': minor
---

Fix the Firestore driver for the modular `firebase/firestore` SDK, and run message posts, edits and reactions in transactions so concurrent writes are not lost. Strip `undefined` values at every depth before writing. Gate the first conversation update until messages have loaded, and cancel snapshot listeners that are unsubscribed before they attach. Add `toggleReaction` to the `ConversationDriver` interface (custom drivers must implement it). Keep `richContent` and re-harvest mentions on edits in the Svelte and React wrappers via the new `buildMessageEdit` helper. Scope the React `useThread` cache per driver and evict idle subscribers. Keep replies below a parent cycle attached in `ThreadTree`.
