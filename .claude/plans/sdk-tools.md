# claude-sdk-tools — Planned Work

## Config

The tools currently take no configuration. Everything is either hardcoded or passed
ad-hoc by the consumer. This is the foundation the other items depend on.

**Config loading**
- Load from `./.claude/tools-config.json` (local) and `~/.claude/tools-config.json` (home).
  Local takes priority; fields merge-overwrite (null in local means "use home value").
- Hot reload during idle phase, same pattern as the CLI config watcher.
- Zod schema for validation, coerce/default on invalid values rather than throwing.
- Publish a JSON schema for the config file so editors can validate it.

**Config resolution**
- Resolve config once at startup into a concrete `ResolvedConfig` object.
- Stop threading optional fields through every function call. Resolved config is passed
  to tool factories; they read from it, not from individual options.
- The existing CLI has this pattern — `claude-sdk-cli/src/cli-config/` is a reference.

---

## Better tool instructions

The tool descriptions drive how Claude uses the tools. They are currently minimal. Better
instructions would reduce mistakes and turn count.

Things worth covering:
- `PreviewEdit`: lead with the `lineEdits`/`textEdits` split; clarify that line numbers
  always reference the file before the call; show a combined example.
- `Exec`: structured args, no shell quoting, pipeline support, when to use `stdin`.
- Batching: call multiple read tools before deciding what to write; avoid a round-trip
  per small decision.
- Whether to deliver instructions as part of tool `description` fields or as a
  `<system-reminder>` block injected into the system prompt. The reminder approach
  keeps descriptions short and puts guidance where Claude refers to it during a turn.

---

## Find tool exclusions

The current `exclude` parameter is a list of directory names matched by basename.
Two improvements:

**Standard regex patterns**
- Rename `pattern` to use standard regex (it already does, just document it).
- Change `exclude` from a list of directory names to a list of regex patterns matched
  against the full relative path.
- Default exclusions should cover `dist/`, `node_modules/`, and all dot directories
  (`^\..*/` — catches `.git`, `.claude`, `.turbo`, etc.).

**Examples in the tool description**
- `pattern: \.(ts|js|svelte|vue)$` — source files
- `pattern: \.(md|html)$` — docs
- `exclude: [dist, node_modules, ^\..*/]` — standard ignores
