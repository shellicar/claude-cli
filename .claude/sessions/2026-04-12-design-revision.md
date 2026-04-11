# Session 2026-04-12 — Conversation Identity Design Revision

Branch: none (design session, no code changes).

## Context

Prompt: `2026-04-11_245_design-revision.md`. Revision of the Phase 0 `ConversationManager` design for issue #245.

The Phase 0 design proposed a single `ConversationManager` class that owned both the conversation id and the lifecycle operations (new conversation, clear). The PM identified this conflates identity management with lifecycle decisions that belong in `main.ts`.

## Done

### Codebase Investigation

Read the following files to understand existing patterns before designing:

- `main.ts` (orchestrator, inline `loadHistory`/`saveHistory`, wiring)
- `Conversation.ts` (SDK, pure in-memory state)
- `CommandModeState.ts`, `ConversationState.ts`, `StatusState.ts` (MVVM state classes)
- `AppLayout.ts` (screen coordinator, command mode dispatch)
- `runAgent.ts` (query execution wiring)
- `QueryRunner.ts` (SDK turn loop)
- `SdkConfigWatcher.ts`, `ClaudeMdLoader.ts`, `GitStateMonitor.ts` (infrastructure classes)
- `ClaudeMdLoader.spec.ts`, `gitSnapshot.spec.ts` (test patterns)
- SDK interfaces and types

Key pattern observations that shaped the designs:
- Infrastructure classes (GitStateMonitor, ClaudeMdLoader, SdkConfigWatcher) are constructed once with their dependencies and provide operations that main.ts calls at lifecycle points
- State classes are pure data + transitions (MVVM layer), no I/O
- The existing loadHistory/saveHistory are inline functions in main.ts
- Tests use injectable dependencies (IFileSystem, SnapshotFn) to avoid real disk

### Design Document

Written to `~/repos/fleet/claude-fleet-shellicar/projects/claude-cli/investigation/2026-04-11_245_design-revision.md`.

Three designs compared:

**Design A (Split Components)**: `ConversationId` + `ConversationHistory` as separate classes. ConversationId holds the current id as instance state. ConversationHistory is stateless (takes id as parameter). Migration is a standalone function. Most modular, but over-decomposed for the actual complexity.

**Design B (Unified Store)**: Single `ConversationStore` class, stateless (no "current id" tracking). Provides five operations: loadId, createId, loadHistory, saveHistory, migrate. CLI holds `let conversationId` and passes it through. Matches the codebase's infrastructure pattern.

**Design C (Pure Functions)**: Five exported functions, no classes. CLI composes them directly, passing paths on every call. Simplest option. Natural evolution from existing inline functions. Diverges from the class-based infrastructure convention.

**Recommended Design B** because:
1. Matches the existing infrastructure pattern (GitStateMonitor, ClaudeMdLoader)
2. Store is stateless, CLI orchestrates (addresses the PM's conflation concern)
3. Migration is natural (store knows both paths)
4. Right granularity for the complexity
5. A sonnet worker implementing this matches existing patterns rather than learning a new one

## Decisions

- **Store holds no current-id state**: The Phase 0 ConversationManager held `#conversationId`. The revised design keeps the store stateless. main.ts holds `let conversationId` and passes it explicitly. This is what makes the store a data access layer rather than a lifecycle manager.

- **History files at `~/.claude/conversations/`** (home-relative, per the constraints): different from Phase 0 which had them cwd-relative. Id file stays cwd-relative (`.claude/.sdk-conversation-id`). The split makes sense: the id is project-specific (which conversation am I in for this directory?), history files are global (all conversations in one place).
