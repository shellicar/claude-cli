# ExecV3 schema (documented shape)

The **interface shape** — the spec the implementation (`schema.ts`) transcribes. Type
notation is for precision, not implementation. Scope/decisions live in `capabilities.md`;
this is the structure.

**Design goal:** the common case (single command, a simple chain, a pipe) is effortless to
produce; advanced shell falls back to a script. Everything below is shaped to keep the 99%
flat and obvious.

---

## Input

```
{
  description: string          // required — human-readable intent (observability + a mild forcing function)
  commands: Command[]          // required — flat list, min 1
  timeout?: number             // default 30000 ms, max 600000 — always enforced, overridable
  stripAnsi?: boolean          // default true
}
```

## Command

```
{
  program: string              // required
  args?: string[]              // default []
  op?: "&&" | "||" | "|"       // how THIS command joins the NEXT (forward-pointing); absent = sequential
  cwd?: string                 // ~ and $VAR expanded
  env?: Record<string, string>
  stdin?: string               // literal stdin (here-string / heredoc equivalent)
  redirect?: {
    stdout?: string            // path; ~/$VAR expanded; overwrite-only
    stderr?: string | "&1"     // path, OR "&1" = "go wherever stdout goes" (folds in 2>&1)
  }
}
```

### `op` — the one novel mechanic

- **Forward-pointing**: `op` on a command says how it connects to the *next* one.
- **Absent** = sequential — the *only* way to express a plain sequence. There is no explicit `;` value: it would be identical to absence, so it's omitted. One way to say sequential, and every *present* `op` therefore means "non-sequential" (bail / pipe / fallback). On the **last** command, absent is the terminator.
- **Precedence** (engine, not author): `|` binds tightest, then `&&`/`||`, then sequential (absent op).
  Evaluation is left-to-right; the engine groups consecutive `|` into one pipeline.
- **No grouping**: anything needing `(a && b) | c` or `a && (b || c)` → script.
- `&` (concurrent) is **deferred** — not a valid value in v1.

### `redirect` — fields, not an array

- Two named keys; a stream goes to exactly one place, so "two destinations for one stream"
  is **unrepresentable** (no validation rule needed).
- `stderr: "&1"` is the only merge direction (the reverse buys nothing — see `capabilities.md`).
- `{ stdout: "f", stderr: "&1" }` = both to one file. `{ stdout: "a", stderr: "b" }` = split.
- Overwrite-only (append → `tee -a`); fd-level / ordered redirects → script.

---

## Validation (request-level → hard reject, no results)

These are the "can't start" failures. Loud, structured rejection — never silent.
The shape makes most illegal states unrepresentable; these are the residual rules:

- `description` non-empty, `commands` ≥ 1, each `program` non-empty.
- A real operator (`|` / `&&` / `||`) on the **last** command → reject (dangling operator;
  `&`-style trailing is moot since `&` isn't in v1).
- `redirect.stdout` set **and** `op: "|"` → reject (stdout can't both pipe and write a file;
  use `tee`). [R4]
- `stdin` set on a command that is the **target** of a pipe (previous `op: "|"`) → reject
  (the pipe owns stdin). [NE2]
- A blocked program (builtin rules) → reject before anything runs.

## Result (item-level errors live here)

```
{
  results: Array<{
    stdout: string             // "" when consumed by a pipe (non-terminal stage)
    stderr: string             // per-command; captured even inside a pipe
    exitCode: number | null    // null when signal-killed
    signal: string | null
  }>                           // position-indexed: results[i] ↔ commands[i]
  success: boolean             // aggregate: did the commands achieve the goal (left-to-right fold)
}
```

- **The per-command results array *is* the item-level error bag** — no separate `errors`
  field needed (Exec's natural advantage; see `docs/error-reporting.md`).
- A command failing (non-zero / 127 / 126 / timeout) is **data, not a tool error** — it comes
  back as a result entry. Whether a sibling stops the rest is the caller's choice via `op`.
- `success` reflects whether the *work* succeeded. "Did the invocation run?" is answered by
  getting results at all vs a validation reject.

---

## The common case is tiny (the CX target)

```
// single command
{ "description": "list the dir", "commands": [{ "program": "ls" }] }

// build then test (&&)
{ "description": "build then test",
  "commands": [
    { "program": "pnpm", "args": ["build"], "op": "&&" },
    { "program": "pnpm", "args": ["test"] }
  ] }

// pipe
{ "description": "count matches",
  "commands": [
    { "program": "grep", "args": ["-r", "TODO", "."], "op": "|" },
    { "program": "wc", "args": ["-l"] }
  ] }
```

No nesting, no operators on the trivial case, no quoting. Anything that wants grouping,
variables, substitution, loops, or globbing is a **script** — by design.

---

## Inherited decisions (traceability)

- no `id` — results are position-indexed.
- no `merge_stderr` — folded into `redirect.stderr: "&1"`.
- no `chaining` — replaced by per-command `op`.
- no `both` redirect key — `{ stdout, stderr: "&1" }`.
- `&`, stdin-from-file, append: deferred (see `capabilities.md` → Deferred).
- no explicit `;` — sequential is an absent `op`; the enum is non-sequential only (`&& || |`).
- field names mirror Exec for consistency.
