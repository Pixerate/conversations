# Canonical Wire Schema (v1)

`@pixerate/conversations` uses a language-neutral JSON wire format across Cloud Firestore, local JSON sidecars, JavaScript/TypeScript clients, and native Swift/Apple clients (`ConversationsKit`).

Canonical JSON Schema (Draft-07) files are generated directly from the Zod schemas in [`src/lib/types.ts`](../src/lib/types.ts) and exported via `@pixerate/conversations/json-schema/*` (see [`json-schema/index.json`](../json-schema/index.json)).

---

## 1. Storage Layout

### Cloud Firestore
- **Conversations collection** (default `conversations`):
  `conversations/{conversationId}` -> `Conversation` JSON document.
- **Messages subcollection** (default `messages`):
  `conversations/{conversationId}/messages/{messageId}` -> `Message` JSON document.

### Sidecar / Document JSON
Native editors that store review threads offline alongside a document (for example in a sidecar file or bundle wrapper) serialize `Conversation` and `Message` objects using the exact same JSON field names and types.

---

## 2. Wire Conventions

1. **Timestamps**: All date/time fields (`createdAt`, `updatedAt`, `lastMessageAt`, `resolvedAt`, `MessageReaction.createdAt`) are ISO-8601 UTC strings, e.g. `"2026-11-24T12:00:00.000Z"`.
2. **No `undefined` values**: Firestore rejects `undefined` at any nesting depth. Optional fields that are unset are omitted from the JSON object rather than set to `null`, **except** `Message.parentId` which may be `null` or omitted for root comments.
3. **Defaults when omitted on wire**:
   - `EntityRef.type`: `"task"`
   - `NotificationActor.type`: `"user"`
   - `TextAnchor.state`: `"attached"`
   - `Message.status`: `"sent"`
   - `Message.mentions`: `[]`
   - `Message.attachments`: `[]`
   - `Message.reactions`: `[]`
   - `Conversation.status`: `"open"`
   - `Conversation.participantIds`: `[]`
   - `Conversation.messageCount`: `0`
4. **UTF-16 Code Unit Offsets (`TextAnchor`)**:
   `TextAnchor.start` (inclusive) and `TextAnchor.end` (exclusive) are **0-based UTF-16 code unit indices** (`0 <= start <= end <= documentText.utf16.count`). This matches:
   - JavaScript `String.prototype.slice(start, end)` and `.length`
   - Apple `NSString` / `NSRange(location: start, length: end - start)` / `String.UTF16View`
5. **Transaction Invariants**:
   - Posting a message increments `Conversation.messageCount`, adds `author.id` to `participantIds`, and updates `lastMessageAt` / `updatedAt` in the same Firestore transaction as writing the `Message` document.
   - Clearing a conversation's anchor removes the `anchor` field from the stored document rather than storing `anchor: null`.

---

## 3. Data Models

### `Conversation`

| Field | JSON Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | `string` | Yes | — | Unique conversation identifier |
| `entity` | `EntityRef` | Yes | — | Target entity (e.g. `{ id: "doc_1", type: "document" }`) |
| `anchor` | `TextAnchor` | No | — | Optional text selection anchor for inline comments |
| `status` | `"open" \| "resolved" \| "archived"` | No | `"open"` | Lifecycle state |
| `participantIds` | `string[]` | No | `[]` | Unique author IDs participating in the thread |
| `messageCount` | `number` (non-negative) | No | `0` | Count of messages in the thread |
| `lastMessageAt` | `string` (ISO-8601) | No | — | Timestamp of the most recent message |
| `resolvedAt` | `string` (ISO-8601) | No | — | Timestamp when marked `"resolved"` |
| `resolvedBy` | `string` | No | — | Actor ID that resolved the thread |
| `metadata` | `Record<string, unknown>` | No | — | Arbitrary JSON object metadata |
| `createdAt` | `string` (ISO-8601) | Yes | — | Creation timestamp |
| `updatedAt` | `string` (ISO-8601) | Yes | — | Last update timestamp |

### `EntityRef`

| Field | JSON Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | `string` | Yes | — | Entity identifier |
| `type` | `string` | No | `"task"` | Entity kind (`"document"`, `"task"`, `"canvas_node"`, `"asset"`, `"generation"`, etc.) |
| `title` | `string` | No | — | Human-readable entity title |
| `projectId` | `string` | No | — | Optional enclosing project/workspace identifier |
| `metadata` | `Record<string, unknown>` | No | — | Arbitrary JSON object metadata |

### `TextAnchor` (`DocumentAnchor`)

| Field | JSON Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `start` | `integer >= 0` | Yes | — | Inclusive UTF-16 code unit start offset |
| `end` | `integer >= start` | Yes | — | Exclusive UTF-16 code unit end offset |
| `quote` | `TextQuoteSelector` | Yes | — | W3C Web Annotation style quote selector |
| `state` | `"attached" \| "orphaned"` | No | `"attached"` | Whether the anchor currently resolves in the document |

### `TextQuoteSelector`

| Field | JSON Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `exact` | `string` | Yes | — | Exact selected text when anchored |
| `prefix` | `string` | No | — | Preceding context (typically up to 32 UTF-16 code units) |
| `suffix` | `string` | No | — | Following context (typically up to 32 UTF-16 code units) |

### `Message`

| Field | JSON Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | `string` | Yes | — | Unique message identifier |
| `conversationId` | `string` | Yes | — | Parent conversation ID |
| `author` | `NotificationActor` | Yes | — | Message author |
| `content` | `string` | Yes | — | Plain-text message body |
| `richContent` | `string` | No | — | Optional HTML body |
| `parentId` | `string \| null` | No | `null` | Parent message ID for nested replies |
| `status` | `"sent" \| "pending" \| "failed" \| "deleted"` | No | `"sent"` | Delivery/deletion state |
| `mentions` | `string[]` | No | `[]` | Referenced actor IDs |
| `stickers` | `string[]` | No | — | Inline sticker identifiers |
| `attachments` | `Record<string, unknown>[]` | No | `[]` | Attachment descriptors |
| `reactions` | `MessageReaction[]` | No | `[]` | Emoji or sticker reactions |
| `metadata` | `Record<string, unknown>` | No | — | Arbitrary JSON object metadata |
| `createdAt` | `string` (ISO-8601) | Yes | — | Creation timestamp |
| `updatedAt` | `string` (ISO-8601) | No | — | Last edit timestamp |

### `NotificationActor`

| Field | JSON Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | `string` | Yes | — | Unique user, agent, or system ID |
| `name` | `string` | No | — | Display name |
| `email` | `string` | No | — | Optional email address |
| `avatarUrl` | `string` | No | — | Optional avatar URL |
| `type` | `"user" \| "agent" \| "system"` | No | `"user"` | Actor kind |

### `MessageReaction`

| Field | JSON Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `emoji` | `string` | Yes | — | Emoji character or `:shortcode:` display token |
| `sticker` | `string` | No | — | Optional sticker identifier when reacting with a sticker |
| `userId` | `string` | Yes | — | Reacting actor ID |
| `createdAt` | `string` (ISO-8601) | No | — | Reaction timestamp |

---

## 4. Native Swift Usage (`ConversationsKit`)

Add the repository as a Swift Package Manager dependency (Foundation-only, macOS 13+ / iOS 16+):

```swift
dependencies: [
    .package(url: "https://github.com/Pixerate/conversations.git", from: "0.2.0")
]
```

```swift
import ConversationsKit

let anchor = try TextAnchorReconciler.create(in: markdownText, start: nsRange.location, end: NSMaxRange(nsRange))
let updatedAnchor = TextAnchorReconciler.reconcile(anchor, in: editedMarkdownText)
let range = updatedAnchor.nsRange // Safe NSRange in UTF-16 code units
```
