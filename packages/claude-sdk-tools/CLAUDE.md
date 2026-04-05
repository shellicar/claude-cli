# @shellicar/claude-sdk-tools

## Architecture

Tool implementations for use with `@shellicar/claude-sdk`. Each tool is a standalone module under `src/<ToolName>/` with its own schema, types, and handler. Tools are exported via named entry points in `package.json`.

## Filesystem abstraction

Tools that touch the filesystem take an `IFileSystem` dependency (see `src/fs/IFileSystem.ts`). This keeps tools testable without touching disk.

| Implementation | Used in |
|---|---|
| `NodeFileSystem` | Production (default export from entry points) |
| `MemoryFileSystem` | Tests |

## Ref system

The Ref system reduces context window pressure by replacing large tool outputs with compact `{ ref, size, hint }` tokens that Claude can fetch on demand.

### Components

- **`RefStore`** — in-memory store. `store(content, hint?)` → UUID. `walkAndRef(value, threshold, hint?)` recursively walks a JSON-compatible tree and ref-swaps any string exceeding the threshold. Uniform string arrays (e.g. ReadFile `values`) are joined with `\n` and stored as a single ref, enabling natural char-offset pagination.
- **`createRef(store, threshold)`** — returns `{ tool, transformToolResult }`. Wire `transformToolResult` into `runAgent()` and add `tool` to the tool list. The Ref tool itself is exempt from `transformToolResult` to prevent infinite ref chains.

### Wiring (consumer)

```typescript
const store = new RefStore();
const { tool: Ref, transformToolResult } = createRef(store, 2_000);

runAgent({ transformToolResult, tools: [...tools, Ref] });
```

### Future: `IRefStore` interface

The current `RefStore` is in-memory only — refs are lost on process restart. The planned extensibility path is:

```typescript
export interface IRefStore {
  store(content: string, hint?: string): string; // returns id
  get(id: string): string | undefined;
  has(id: string): boolean;
  delete(id: string): void;
}
```

`createRef` would take `IRefStore` instead of the concrete class. Consumers who want persistence implement the interface against whatever backend they choose (file, SQLite, etc.). The in-memory `RefStore` remains the default and is the right starting point — easy to implement, easy to test.

Same pattern as `IFileSystem`: SDK provides the interface and a default, consumer provides opinions.

## ReadFile size limit

`ReadFile` rejects files over 500KB before reading (checked via `IFileSystem.stat`). For larger files use `Head`, `Tail`, `Range`, `Grep`, or `SearchFiles`.
