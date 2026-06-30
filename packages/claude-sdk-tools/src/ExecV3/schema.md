# ExecV3 schema (documented shape)

The **interface shape** — the spec the implementation (`schema.ts`) transcribes. Type
notation is for precision, not implementation.

**Design goal:** the common case (single command, a simple chain, a pipe) is effortless to
produce; advanced shell falls back to a script. Everything below is shaped to keep the 99%
flat and obvious.

---

## Input

```
{
  intent: string               // required — Claude's intent for the run: the goal, not a restatement of the command (observability + a mild forcing function)
  commands: Command[]          // required — flat list, min 1
  timeout?: number             // default 30000 ms, max 600000, overridable
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
- **Precedence** (engine, not author): **bash's, exactly.** `|` binds tightest, then `&&`/`||` (equal precedence, left-associative — `a && b || c` is `(a && b) || c`), then sequential (absent op). Evaluation is left-to-right; the engine groups consecutive `|` into one pipeline.
- **No grouping**: anything needing `(a && b) | c` or `a && (b || c)` → script.
- `&` (concurrent) is **deferred** — not a valid value in v1.

### `redirect` — fields, not an array

- Two named keys; a stream goes to exactly one place, so "two destinations for one stream"
  is **unrepresentable** (no validation rule needed).
- `stderr: "&1"` is the only merge direction.
- `{ stdout: "f", stderr: "&1" }` = both to one file. `{ stdout: "a", stderr: "b" }` = split.
- Overwrite-only (append → `tee -a`); fd-level / ordered redirects → script.

---

## Semantics — bash, exactly

The operators are not a new dialect. Evaluation, precedence, and exit status are **bash's**,
deliberately and without divergence:

- **Evaluation / precedence** as in `op` above — bash's, `&&`/`||` equal and left-associative, `|` tightest.
- **Exit status** is bash list semantics: the status of the list is the status of the **last command actually executed** — `a` when `&&` short-circuits, `b` when `||` falls through. `success` is `$? == 0` on that fold (so `a || b` with `b` succeeding → `success: true`).
- **Pipeline status** is the **last stage**, like bash's default. No `pipefail`: `grep nothing | wc -l` succeeds. The per-stage truth already lives in the per-command `results` array.
- **Short-circuit is skip-and-continue, not stop.** A short-circuited `&&`/`||` skips only its own next command; `$?` carries unchanged to the next connector, which gates again. So a sequential step (absent `op`) after a short-circuited chain still runs — `test -f x && echo yes` followed by a sequential `echo done` runs `echo done`, exactly as bash does. A skipped command's `results` slot is `null` (see Result).

**The authoring rule this produces:** every example is a **bash-equivalent pair** — the bash, and the JSON that is *that bash, structured*. The JSON must read as a faithful transposition: same operators, same precedence, same outcome. Divergence is permitted, but only as an **explicit, documented choice with its reason stated** — never silent.

---

## Validation (request-level → hard reject, no results)

These are the "can't start" failures. Loud, structured rejection — never silent.
The shape makes most illegal states unrepresentable; these are the residual rules:

- `intent` non-empty, `commands` ≥ 1, each `program` non-empty.
- A real operator (`|` / `&&` / `||`) on the **last** command → reject (dangling operator).
- `redirect.stdout` set **and** `op: "|"` → reject (stdout can't both pipe and write a file;
  use `tee`). [R4]
- `stdin` set on a command that is the **target** of a pipe (previous `op: "|"`) → reject
  (the pipe owns stdin). [NE2]
- A blocked program (builtin rules) → rejected before execution (returned as a structured
  BLOCKED result, consistent with Exec / ExecV2).

## Result (item-level errors live here)

```
{
  results: Array<{
    stdout: string             // "" when consumed by a pipe (non-terminal stage)
    stderr: string             // per-command; captured even inside a pipe
    exitCode: number | null    // null when signal-killed
    signal: string | null
  } | null>                    // length matches commands; results[i] ↔ commands[i].
                               // null = commands[i] was short-circuited and never ran.
  success: boolean             // $? == 0 under bash list exit status (see "Semantics — bash, exactly")
}
```

- **The per-command results array *is* the item-level error bag** — no separate `errors` field needed.
- A command failing (non-zero / 127 / 126 / timeout) is **data, not a tool error** — it comes back as a result entry. Whether a sibling stops the rest is the caller's choice via `op`.
- **A short-circuited command is `null`, not a placeholder object.** The array length always matches `commands`, so `results[i]` maps to `commands[i]` with no decoding. A skipped command genuinely has no result, so its slot is `null` — which also keeps `exitCode: null` meaning exactly one thing (signal-killed), never "skipped". Parse defensively: `results[i]?.exitCode`.

---

## The common case is tiny (the CX target)

```
// single command — bash: ls
{ "intent": "list the dir", "commands": [{ "program": "ls" }] }

// build then test — bash: pnpm build && pnpm test
{ "intent": "build then test",
  "commands": [
    { "program": "pnpm", "args": ["build"], "op": "&&" },
    { "program": "pnpm", "args": ["test"] }
  ] }

// pipe — bash: grep -r TODO . | wc -l
{ "intent": "count matches",
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
- `&`, stdin-from-file, append: deferred.
- no explicit `;` — sequential is an absent `op`; the enum is non-sequential only (`&& || |`).
- field names are ExecV3's own. `description` → `intent` because the field is Claude's *intent* for the run (the goal), not a restatement of the command.
