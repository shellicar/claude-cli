# Shell capability matrix: Exec / ExecV2 / ExecV3

Organised by shell **functionality**, not by scope. Each row is a discrete capability;
the columns show how each tool handles it. Scope (what ExecV3 deliberately leaves out)
is read off the ExecV3 column plus the fallback in Notes.

**Legend**

- ✅ full / In (confirmed)
- 🟡 partial / conditional
- ❌ none / Out
- ❔ undecided (open ExecV3 decision)

> Quoting & escaping is intentionally absent. It is a **parsing** concern, and the
> structured tools have no parse layer — args are passed through literally. How a
> receiving program parses its own data is that program's concern, not Exec's.

---

## 1. Command invocation

| Capability | Exec | ExecV2 | ExecV3 | Notes / fallback |
|---|---|---|---|---|
| run program + args | ✅ | ✅ | ✅ | args are literal strings; no shell quoting needed |
| exit status | ✅ | ✅ | ✅ | per-command `exitCode` on each result |

## 2. I/O — streams

| Capability | Exec | ExecV2 | ExecV3 | Notes / fallback |
|---|---|---|---|---|
| stdin: literal | ✅ | ✅ | ✅ | `stdin` field (covers here-string / heredoc) |
| stdin: from file (`<`) | ❌ | ❌ | ❌ | Out → `cat file \| …` |
| stdout: capture (default) | ✅ | ✅ | ✅ | terminal stage of a pipe; upstream report `""` |
| stdout: to file (`>`) | ✅ | ✅ | ✅ | |
| stdout: append (`>>`) | ✅ | ✅ | ❌ | Out → `tee -a` (overwrite-only; keeps bare-string values) |
| stderr: capture (default) | ✅ | ✅ | ✅ | per-command even inside a pipe |
| stderr: to file (`2>`) | ✅ | ✅ | ✅ | |
| stderr: merge into stdout (`2>&1`) | ✅ | ✅ | ✅ | via `redirect.stderr: "&1"` (folds in `merge_stderr`) |
| both streams → one file | ✅ | ✅ | ✅ | `{ stdout: "f", stderr: "&1" }` (no `both` key) |
| stdout & stderr → different files | ❌ | ❌ | ✅ | fields: `{ stdout: "a", stderr: "b" }` |
| fd-level redirects (`3>`) | ❌ | ❌ | ❌ | Out → script (exotic) |
| ordered redirects (`2>&1 >f`) | ❌ | ❌ | ❌ | Out → script (fd-dup quirk, not wanted) |
| redirect/pipe conflict | 🟡 | ✅ | ✅ | Exec: silently mishandles; V2/V3: loud reject (R4/NE2) |

## 3. Composition

| Capability | Exec | ExecV2 | ExecV3 | Notes / fallback |
|---|---|---|---|---|
| sequence `;` | 🟡 | ✅ | ✅ | Exec: only via global `chaining: sequential` |
| and `&&` | 🟡 | ✅ | ✅ | Exec: only via global `chaining: bail_on_error` |
| or `\|\|` | ❌ | ✅ | ✅ | Exec: not expressible |
| pipe `\|` | 🟡 | ✅ | ✅ | Exec: via multi-command step |
| concurrent / background `&` | 🟡 | ✅ | ❌ | Out (v1) → sequential; top deferred re-add candidate |
| mixed operators | ❌ | ✅ | ✅ | ExecV3: left-to-right, shell precedence (no grouping) |
| grouping `( )` `{ }` | ❌ | ✅ | ❌ | Out → script |

## 4. Execution environment

| Capability | Exec | ExecV2 | ExecV3 | Notes / fallback |
|---|---|---|---|---|
| cwd per command | ✅ | ✅ | ✅ | `cwd` field |
| env vars per command | ✅ | ✅ | ✅ | `env` field |
| env from file (`.env`) | ❌ | ❌ | ❌ | Out → in-band: `node --env-file` / `dotenvx run --` (loads child-side, secret-safe) |
| `~` / `$VAR` in path fields | ✅ | ✅ | ✅ | program, cwd, redirect paths only — not args |

## 5. Expansion

| Capability | Exec | ExecV2 | ExecV3 | Notes / fallback |
|---|---|---|---|---|
| `$VAR` in args | ❌ | ❌ | ❌ | args literal → script if genuinely needed |
| command substitution `$(…)` | ❌ | ❌ | ❌ | Out → multi-step (non-secret) / script (secret); program's `--x-file` where it exists |
| arithmetic `$((…))` | ❌ | ❌ | ❌ | Out → script |
| parameter expansion `${…}` | ❌ | ❌ | ❌ | Out → script |
| glob `*` `?` `[…]` | ❌ | ❌ | ❌ | Out → `find` / the program's own globbing |
| brace expansion `{a,b}` | ❌ | ❌ | ❌ | Out → script |

## 6. Variables & state

| Capability | Exec | ExecV2 | ExecV3 | Notes / fallback |
|---|---|---|---|---|
| assignment `x=1` | ❌ | ❌ | ❌ | Out → script |
| arrays | ❌ | ❌ | ❌ | Out → script |
| special params `$?` `$$` `$!` | ❌ | ❌ | ❌ | Out → script |
| export / scope | 🟡 | 🟡 | 🟡 | per-command `env` only; full export semantics → script |

## 7. Control structures

| Capability | Exec | ExecV2 | ExecV3 | Notes / fallback |
|---|---|---|---|---|
| `if` / `case` | ❌ | ❌ | ❌ | Out → script |
| `for` / `while` / `until` | ❌ | ❌ | ❌ | Out → script |
| functions | ❌ | ❌ | ❌ | Out → script |
| tests `[ ]` `[[ ]]` | 🟡 | 🟡 | 🟡 | `test` / `[` are invocable programs; shell `[[ ]]` → script |

## 8. Job & process control

| Capability | Exec | ExecV2 | ExecV3 | Notes / fallback |
|---|---|---|---|---|
| background `&` | 🟡 | ✅ | ❌ | see Composition |
| `wait` (join) | ✅ | ✅ | ✅ | all tools join before returning; ExecV3 makes it explicit for `&` |
| `jobs` / `fg` / `bg` | ❌ | ❌ | ❌ | Out → interactive only |
| signals / `kill` / `trap` | 🟡 | 🟡 | 🟡 | `kill` invocable as a program; `trap` / handlers → script |
| `nohup` / `disown` (persist) | ❌ | ❌ | ❌ | Out → dedicated long-running-process tool |
| timeout | ✅ | ✅ | ✅ | ExecV3: default 30s, overridable |

---

## ExecV3 decisions

### Deferred (not in v1) — priority order if scope expands

All three have a cheap in-band fallback, so none blocks v1. Listed in the order they'd be added back, by likelihood × ease:

1. **background `&`** — **the next feature to add.** Trivial: one `op` enum value, non-breaking. Most likely wanted (concurrency = latency win). Until then: run sequentially.
2. **stdin from file (`<`)** — additive (`stdinFile` field). Until then: `cat file \| …`.
3. **stdout append (`>>`)** — costliest (redirect values would go from bare string to `{ path, append }`). Lowest priority. Until then: `tee -a`.

### Resolved

- **Redirect representation: fields** — `redirect: { stdout?: path, stderr?: path | "&1" }`. Covers to-file, both-to-one-file (`stderr: "&1"`), and different files. `merge_stderr` and `both` are folded in (removed). `stderr: "&1"` is the only merge direction (the reverse buys nothing). fd-level and ordered redirects are Out → script.

---

## Cost of being Out (severity)

In/out alone doesn't capture how much an Out *hurts* — that depends on the fallback.
Buckets, lightest to heaviest:

- **free** — the model produces it directly, no real loss:
  - `$VAR` in args (when the value is known), arithmetic `$((…))` (constants),
    brace expansion `{a,b}` (just write the items out)
- **in-band** — another program or flag covers it, no script:
  - glob → `find` / the program's own globbing
  - `&` → run sequentially
  - tests `[ ]` → `test` / `[` as programs
  - stdin from file → `cat file | …`
  - append (`>>`) → `tee -a`
  - env from file → `node --env-file` / `dotenvx run --`
- **+turn** — forced into multi-step (an extra tool call):
  - command substitution `$(…)` for a **non-secret** runtime value
- **script** — forces a script (the heavy ones):
  - command substitution for a **secret** value (multi-step would leak it through the model)
  - variables / assignment, advanced parameter expansion `${x:-…}`
  - control structures (`if` / `for` / `while` / `case` / functions)
  - grouping `( )` `{ }`
  - fd-level redirects, ordered redirects, stdout & stderr → different files
- **n/a** — no agent fallback (not a script gap):
  - `jobs` / `fg` / `bg` (interactive only); `nohup` / `disown` → dedicated long-running-process tool

This is what makes the priority concrete: `&` sits in **in-band** (cope by sequencing),
while `$(…)` sits in **+turn / script** — so its Out costs more, exactly as expected.
