# Agent Instructions & Execution Rules

This document defines mandatory rules, quality standards, and post-completion workflows that AI agents and engineers operating in `@pixerate/conversations` MUST strictly follow.

---

## Core Development Guidelines

### 1. How to Commit
- **Conventional Commits**: Every commit message MUST adhere strictly to the Conventional Commits specification:
  - `feat: ...` for new capabilities, thread tree utilities, storage drivers, or framework hooks.
  - `fix: ...` for bug fixes, edge case handling, tree cycle resolution, or patch corrections.
  - `docs: ...` for documentation, markdown guides, or architecture diagrams.
  - `test: ...` for adding or updating unit tests and test fixtures.
  - `refactor: ...` for internal structural improvements with zero functional/behavioral regressions.
  - `chore: ...` for dependency updates, toolchain configuration, or maintenance.
- **Surgical Staging**: Never commit unrelated files, debug logs (`*.log`), or scratch files. Stage changes with exact precision (`git add <file>`).
- **Atomic Commits**: Keep changes focused and traceable to the specific task or user requirement.

### 2. Always Create Unit Tests
- **Mandatory Test Coverage**: Every new conversation manager, storage driver, thread tree algorithm, transcript serializer, Svelte 5 rune, or React hook MUST have corresponding Vitest unit tests in `src/lib/__tests__/*.test.ts`.
- **Zero Mocking of Core Logic**: When testing algorithms (hierarchical thread building, tree flattening, parent-child ordering, cycle detection, orphan parent recovery, mention token extraction), test real behavior.
- **Offline In-Memory Drivers**: Use `MemoryConversationDriver` for isolated, ultra-fast, deterministic unit tests without network or GCP dependencies.
- **Edge Cases & Failure Modes**: Write explicit tests for:
  - Deeply nested replies (10+ levels).
  - Deleted or missing parent comments (orphans grouped safely or kept at root).
  - Cyclic parent-child references (preventing infinite recursion).
  - Firestore snapshot listener lifecycle, unsubscribe cleanup, and optimistic updates.
  - Svelte 5 `$state` and `$derived` signal reactivity.
  - React 19 `useSyncExternalStore` hydration and flicker-free updates.
- **Run Locally Before Finishing**: Always execute `npm run test` (or `npx vitest run`) and guarantee 100% green tests before committing.

### 3. Maintain Architectural Boundaries
- **UI-Agnostic Core**: Core logic in `src/lib/core/` and `src/lib/drivers/` must remain completely decoupled from specific frontend frameworks.
- **Framework Wrappers**: Svelte 5 runes (`src/lib/svelte/`) and React hooks (`src/lib/react/`) are thin wrappers around the core store and drivers.
- **Do NOT re-implement Rich Text Editing**: Input composition, markdown serialization, and formatting belong in `@pixerate/editor`.
- **Do NOT re-implement Notifications**: In-app badges, email delivery, and multi-channel routing belong in `@pixerate/notifications`.
- **Do NOT re-implement Ephemeral Presence**: Live cursors, room streams, and typing indicators belong in `@pixerate/realtime`.
- **Do NOT re-implement Team RBAC**: Organizations, memberships, and fuel transactions belong in `@pixerate/teams`.

### 4. Check and Maintain `GOTCHAS.md`
- **Check Before Starting Work**: Always review `GOTCHAS.md` before beginning work to avoid known issues, pitfalls, platform quirks, and edge cases.
- **Maintain and Populate**: Continuously populate and maintain `GOTCHAS.md` whenever encountering new issues, pitfalls, unexpected behaviors, or edge cases, documenting their verified solutions and workarounds.

---

## Mandatory Work Completion Checklist

```
[Start Task]
       │
       ▼
[Check `GOTCHAS.md` for Known Issues & Pitfalls]
       │
       ▼
[Work Completed]
       │
       ▼
[Created/Modified Code or Adapters?] ──Yes──► [Create Corresponding Vitest Unit Tests]
       │                                            │
       └──No───────────────┬────────────────────────┘
                           │
                           ▼
          [Verify: `npm run check` & `npm run test`]
                           │
                           ▼
          [Verify Library Build: `npm run build`]
                           │
                           ▼
     [Encountered Quirks/Pitfalls?] ──Yes──► [Update `GOTCHAS.md`]
                           │                           │
                           └──No───────────────┬───────┘
                                               │
                                               ▼
                              [Create Changeset: `npx changeset`]
                                               │
                                               ▼
                              [Commit with Conventional Commit (`git commit`)]
                                               │
                                               ▼
                              [Push & Monitor CI (`test.yml`)]
```
