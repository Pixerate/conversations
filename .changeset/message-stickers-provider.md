---
"@pixerate/conversations": minor
---

Add `StickerProvider` support for inline message stickers and sticker reactions, including `:id:` (single-pack) and `:pack-id:` (multi-pack) shortcode formatting/parsing, HTML token extraction, `resolveSticker` / `resolveMessageStickers` helpers, agent sticker tools (`createMessageStickerTools`), and integration across `ConversationManager`, Svelte 5 `ThreadStore`, and React 19 `useThread`.
