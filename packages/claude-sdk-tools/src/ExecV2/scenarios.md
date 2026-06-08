# ExecV2 Scenarios Catalog

This document is the source of truth for both `test/Exec/scenarios.spec.ts` (V1 characterisation) and `test/ExecV2/scenarios.spec.ts` (V2 contract tests).

## Catalog convention for ids

Every `Command` in V2 carries a required `id: string`. Ids in test code follow tree pre-order: the first leaf encountered (walk left subtree before right at every node) is `"a"`, second is `"b"`, third is `"c"`, and so on.

V2 tests assert by id: `results.find(r => r.id === 'a')` (or a `byId` helper). V1 tests stay positional (V1 has no id concept).

---

#### S1 — single command, success

Bash: `echo hello`

Current Exec:
```json
{ "description": "S1", "steps": [{ "commands": [{ "program": "echo", "args": ["hello"] }] }] }
```

ExecV2:
```json
{ "description": "S1", "pipeline": { "id": "a", "program": "echo", "args": ["hello"] } }
```

Expected: `success: true`. One result. `results[0].stdout == "hello"`, `exitCode == 0`.

---

#### S2 — single command, non-zero exit

Bash: `sh -c 'exit 1'`

Current Exec:
```json
{ "description": "S2", "steps": [{ "commands": [{ "program": "sh", "args": ["-c", "exit 1"] }] }] }
```

ExecV2:
```json
{ "description": "S2", "pipeline": { "id": "a", "program": "sh", "args": ["-c", "exit 1"] } }
```

Expected: `success: false`. One result. `exitCode == 1`.

---

#### C1 — sequence, both succeed

Bash: `echo a; echo b`

Current Exec:
```json
{ "description": "C1", "chaining": "sequential",
  "steps": [
    { "commands": [{ "program": "echo", "args": ["a"] }] },
    { "commands": [{ "program": "echo", "args": ["b"] }] }
  ] }
```

ExecV2:
```json
{ "description": "C1",
  "pipeline": {
    "op": ";",
    "left": { "id": "a", "program": "echo", "args": ["a"] },
    "right": { "id": "b", "program": "echo", "args": ["b"] }
  } }
```

Expected: `success: true`. Two results. `results[0].stdout == "a"`, `results[1].stdout == "b"`, both exit 0.

---

#### C2 — sequence, first fails, second still runs

Bash: `sh -c 'exit 1'; echo b`

Current Exec:
```json
{ "description": "C2", "chaining": "sequential",
  "steps": [
    { "commands": [{ "program": "sh", "args": ["-c", "exit 1"] }] },
    { "commands": [{ "program": "echo", "args": ["b"] }] }
  ] }
```

ExecV2:
```json
{ "description": "C2",
  "pipeline": {
    "op": ";",
    "left": { "id": "a", "program": "sh", "args": ["-c", "exit 1"] },
    "right": { "id": "b", "program": "echo", "args": ["b"] }
  } }
```

Expected: `success: false`. Two results. `results[0].exitCode == 1`, `results[1].stdout == "b"` and `exitCode == 0`.

---

#### A1 — and, both succeed

Bash: `echo a && echo b`

Current Exec (uses `bail_on_error` — the default):
```json
{ "description": "A1",
  "steps": [
    { "commands": [{ "program": "echo", "args": ["a"] }] },
    { "commands": [{ "program": "echo", "args": ["b"] }] }
  ] }
```

ExecV2:
```json
{ "description": "A1",
  "pipeline": {
    "op": "&&",
    "left": { "id": "a", "program": "echo", "args": ["a"] },
    "right": { "id": "b", "program": "echo", "args": ["b"] }
  } }
```

Expected: `success: true`. Two results. `results[0].stdout == "a"`, `results[1].stdout == "b"`.

---

#### A2 — and, first fails (second skipped)

Bash: `sh -c 'exit 1' && echo b`

Current Exec:
```json
{ "description": "A2",
  "steps": [
    { "commands": [{ "program": "sh", "args": ["-c", "exit 1"] }] },
    { "commands": [{ "program": "echo", "args": ["b"] }] }
  ] }
```

ExecV2:
```json
{ "description": "A2",
  "pipeline": {
    "op": "&&",
    "left": { "id": "a", "program": "sh", "args": ["-c", "exit 1"] },
    "right": { "id": "b", "program": "echo", "args": ["b"] }
  } }
```

Expected: `success: false`. One result (right never ran). `results[0].exitCode == 1`.

---

#### O1 — or, first succeeds (second skipped) — V2 only

Bash: `true || echo b`

Current Exec: (not expressible)

ExecV2:
```json
{ "description": "O1",
  "pipeline": {
    "op": "||",
    "left": { "id": "a", "program": "true" },
    "right": { "id": "b", "program": "echo", "args": ["b"] }
  } }
```

Expected: `success: true`. One result. `results[0].exitCode == 0`.

---

#### O2 — or, first fails (second runs) — V2 only

Bash: `sh -c 'exit 1' || echo b`

Current Exec: (not expressible)

ExecV2:
```json
{ "description": "O2",
  "pipeline": {
    "op": "||",
    "left": { "id": "a", "program": "sh", "args": ["-c", "exit 1"] },
    "right": { "id": "b", "program": "echo", "args": ["b"] }
  } }
```

Expected: `success: true` (right succeeded). Two results. `results[0].exitCode == 1`, `results[1].stdout == "b"`.

---

#### N1 — concurrent, both succeed

Bash: `echo a & echo b & wait`

Current Exec (uses `independent` chaining):
```json
{ "description": "N1", "chaining": "independent",
  "steps": [
    { "commands": [{ "program": "echo", "args": ["a"] }] },
    { "commands": [{ "program": "echo", "args": ["b"] }] }
  ] }
```

ExecV2:
```json
{ "description": "N1",
  "pipeline": {
    "op": "&",
    "left": { "id": "a", "program": "echo", "args": ["a"] },
    "right": { "id": "b", "program": "echo", "args": ["b"] }
  } }
```

Expected: `success: true`. Two results. `results[0].stdout == "a"` (id `'a'`), `results[1].stdout == "b"` (id `'b'`), both `exitCode == 0`. Result array order is tree pre-order regardless of concurrency.

---

#### N2 — concurrent, one fails

Bash: `sh -c 'exit 1' & echo b & wait`

Current Exec:
```json
{ "description": "N2", "chaining": "independent",
  "steps": [
    { "commands": [{ "program": "sh", "args": ["-c", "exit 1"] }] },
    { "commands": [{ "program": "echo", "args": ["b"] }] }
  ] }
```

ExecV2:
```json
{ "description": "N2",
  "pipeline": {
    "op": "&",
    "left": { "id": "a", "program": "sh", "args": ["-c", "exit 1"] },
    "right": { "id": "b", "program": "echo", "args": ["b"] }
  } }
```

Expected: `success: false`. Two results. `results[0].exitCode == 1` (id `'a'`), `results[1].stdout == "b"` and `exitCode == 0` (id `'b'`).

---

#### P1 — pipe, two commands

Bash: `echo hello | cat`

Current Exec:
```json
{ "description": "P1",
  "steps": [
    { "commands": [
        { "program": "echo", "args": ["hello"] },
        { "program": "cat" }
    ] }
  ] }
```

ExecV2:
```json
{ "description": "P1",
  "pipeline": {
    "op": "|",
    "left": { "id": "a", "program": "echo", "args": ["hello"] },
    "right": { "id": "b", "program": "cat" }
  } }
```

Expected V1: `success: true`. One result (V1 collapses a pipeline into one step result). `results[0].stdout == "hello"`.

Expected V2: `success: true`. Two results (one per leaf). `results[0].stdout == ""` (consumed by pipe), `results[0].exitCode == 0`. `results[1].stdout == "hello"`, `results[1].exitCode == 0`.

---

#### P2 — pipe, three commands

Bash: `printf 'a\nb\nc\n' | grep b | wc -l` (expected `1`)

Current Exec:
```json
{ "description": "P2",
  "steps": [
    { "commands": [
        { "program": "printf", "args": ["a\nb\nc\n"] },
        { "program": "grep", "args": ["b"] },
        { "program": "wc", "args": ["-l"] }
    ] }
  ] }
```

ExecV2 (left-associative pipe):
```json
{ "description": "P2",
  "pipeline": {
    "op": "|",
    "left": {
      "op": "|",
      "left": { "id": "a", "program": "printf", "args": ["a\nb\nc\n"] },
      "right": { "id": "b", "program": "grep", "args": ["b"] }
    },
    "right": { "id": "c", "program": "wc", "args": ["-l"] }
  } }
```

Expected V1: `success: true`. One result. `results[0].stdout` matches `/^\s*1$/` (wc output may have leading whitespace).

Expected V2: `success: true`. Three results. `results[0..1].stdout == ""` (consumed), `results[2].stdout` matches `/^\s*1$/`.

---

#### P3 — pipe, first stage fails (divergence point)

Bash with pipefail: `set -o pipefail; sh -c 'echo done; exit 1' | cat; echo $?` → `1`. Without pipefail: `0`.

Current Exec:
```json
{ "description": "P3",
  "steps": [
    { "commands": [
        { "program": "sh", "args": ["-c", "echo done; exit 1"] },
        { "program": "cat" }
    ] }
  ] }
```

ExecV2:
```json
{ "description": "P3",
  "pipeline": {
    "op": "|",
    "left": { "id": "a", "program": "sh", "args": ["-c", "echo done; exit 1"] },
    "right": { "id": "b", "program": "cat" }
  } }
```

Expected V1: `success: true` (V1 reports only the last command's exit, which is `cat`'s zero). `results[0].stdout == "done"`.

Expected V2: `success: false` (pipefail). Two results. `results[0].exitCode == 1`, `results[0].stdout == ""` (consumed). `results[1].stdout == "done"`, `results[1].exitCode == 0`.

---

#### M1 — mixed: `&&` then `||` — V2 only

Bash: `sh -c 'exit 1' && echo a || echo b`

Current Exec: (not expressible — mixing operators)

ExecV2 (left-associative: `(false && a) || b`):
```json
{ "description": "M1",
  "pipeline": {
    "op": "||",
    "left": {
      "op": "&&",
      "left": { "id": "a", "program": "sh", "args": ["-c", "exit 1"] },
      "right": { "id": "b", "program": "echo", "args": ["a"] }
    },
    "right": { "id": "c", "program": "echo", "args": ["b"] }
  } }
```

Expected: `success: true`. Two results — the `&&`-left failed (so echo a skipped), the outer `||` ran echo b. `results[0].exitCode == 1` (id `'a'`), `results[1].stdout == "b"` (id `'c'`).

---

#### M2 — mixed: `;` and `&&` — V2 only

Bash: `echo a; sh -c 'exit 1' && echo b`

Current Exec: (not expressible)

ExecV2 (precedence: `&&` binds tighter than `;` → `a; (false && b)`):
```json
{ "description": "M2",
  "pipeline": {
    "op": ";",
    "left": { "id": "a", "program": "echo", "args": ["a"] },
    "right": {
      "op": "&&",
      "left": { "id": "b", "program": "sh", "args": ["-c", "exit 1"] },
      "right": { "id": "c", "program": "echo", "args": ["b"] }
    }
  } }
```

Expected: `success: false`. Two results — `echo a` ran, `false` ran and failed (so `echo b` skipped). `results[0].stdout == "a"` (id `'a'`), `results[1].exitCode == 1` (id `'b'`).

---

#### M3 — group on left of pipe — V2 only

Bash: `(echo a && echo b) | wc -l` → `2`

Current Exec: (not expressible — pipe and chaining cannot mix)

ExecV2:
```json
{ "description": "M3",
  "pipeline": {
    "op": "|",
    "left": {
      "op": "&&",
      "left": { "id": "a", "program": "echo", "args": ["a"] },
      "right": { "id": "b", "program": "echo", "args": ["b"] }
    },
    "right": { "id": "c", "program": "wc", "args": ["-l"] }
  } }
```

Expected: `success: true`. Three results — both echoes ran and were consumed by the pipe; wc counted them. `results[0].stdout == ""` (id `'a'`), `results[1].stdout == ""` (id `'b'`), `results[2].stdout` matches `/^\s*2$/` (id `'c'`).

---

#### F1 — stdin literal

Bash: `cat <<<'hello'`

Current Exec:
```json
{ "description": "F1",
  "steps": [{ "commands": [{ "program": "cat", "stdin": "hello" }] }] }
```

ExecV2:
```json
{ "description": "F1",
  "pipeline": { "id": "a", "program": "cat", "stdin": "hello" } }
```

Expected: `success: true`. One result. `results[0].stdout == "hello"`.

---

#### F2 — merge_stderr piped

Bash: `sh -c 'echo out; echo err >&2' 2>&1 | cat` → both lines.

Current Exec:
```json
{ "description": "F2",
  "steps": [
    { "commands": [
        { "program": "sh", "args": ["-c", "echo out; echo err >&2"], "merge_stderr": true },
        { "program": "cat" }
    ] }
  ] }
```

ExecV2:
```json
{ "description": "F2",
  "pipeline": {
    "op": "|",
    "left": { "id": "a", "program": "sh", "args": ["-c", "echo out; echo err >&2"], "merge_stderr": true },
    "right": { "id": "b", "program": "cat" }
  } }
```

Expected V1: one result. `results[0].stdout` contains both `"out"` and `"err"`.

Expected V2: two results. `results[1].stdout` (id `'b'`) contains both `"out"` and `"err"`.

---

#### R1 — redirect stdout (standalone Command)

Bash: `echo hello > /dev/null`

Current Exec:
```json
{ "description": "R1",
  "steps": [{ "commands": [{ "program": "echo", "args": ["hello"],
      "redirect": { "path": "/dev/null", "stream": "stdout" } }] }] }
```

ExecV2:
```json
{ "description": "R1",
  "pipeline": { "id": "a", "program": "echo", "args": ["hello"],
    "redirect": { "path": "/dev/null", "stream": "stdout" } } }
```

Expected (V1 and V2): `success: true`. One result. `results[0].stdout == ""` (consumed by redirect), `results[0].exitCode == 0`.

---

#### R2 — redirect stderr (standalone Command)

Bash: `sh -c 'echo err >&2' 2> /dev/null`

Current Exec:
```json
{ "description": "R2",
  "steps": [{ "commands": [{ "program": "sh", "args": ["-c", "echo err >&2"],
      "redirect": { "path": "/dev/null", "stream": "stderr" } }] }] }
```

ExecV2:
```json
{ "description": "R2",
  "pipeline": { "id": "a", "program": "sh", "args": ["-c", "echo err >&2"],
    "redirect": { "path": "/dev/null", "stream": "stderr" } } }
```

Expected (V1 and V2): `success: true`. One result. `results[0].stderr == ""` (consumed by redirect), `results[0].exitCode == 0`.

---

#### R3 — redirect on the last command of a pipe

Bash: `echo hello | cat > /dev/null`

Current Exec:
```json
{ "description": "R3",
  "steps": [
    { "commands": [
        { "program": "echo", "args": ["hello"] },
        { "program": "cat", "redirect": { "path": "/dev/null", "stream": "stdout" } }
    ] }
  ] }
```

ExecV2:
```json
{ "description": "R3",
  "pipeline": {
    "op": "|",
    "left": { "id": "a", "program": "echo", "args": ["hello"] },
    "right": { "id": "b", "program": "cat",
      "redirect": { "path": "/dev/null", "stream": "stdout" } }
  } }
```

Expected V1: `success: true`. One result (V1 collapses the pipeline). `results[0].stdout == "hello"`. **V1 quirk**: `execPipeline` unconditionally adds `lastChild.stdout.on('data', ...)` before setting up the redirect, so both the capture buffer and the redirect file receive data. The standalone case (`execCommand`) correctly suppresses capture when redirected; `execPipeline` does not. `results[0].exitCode == 0`.

Expected V2: `success: true`. Two results. `results[0]` (id `'a'`, echo) has `stdout == ""` (consumed by pipe) and `exitCode == 0`. `results[1]` (id `'b'`, cat) has `stdout == ""` (consumed by redirect) and `exitCode == 0`.

---

#### R4 — redirect on a non-last (pipe-source) command — divergence point

Bash: `echo hello > /dev/null | cat` — bash redirects echo's stdout to the file; the pipe carries nothing; `cat` reads EOF and outputs empty.

Current Exec:
```json
{ "description": "R4",
  "steps": [
    { "commands": [
        { "program": "echo", "args": ["hello"],
          "redirect": { "path": "/dev/null", "stream": "stdout" } },
        { "program": "cat" }
    ] }
  ] }
```

ExecV2:
```json
{ "description": "R4",
  "pipeline": {
    "op": "|",
    "left": { "id": "a", "program": "echo", "args": ["hello"],
      "redirect": { "path": "/dev/null", "stream": "stdout" } },
    "right": { "id": "b", "program": "cat" }
  } }
```

Expected V1: `success: true`. One result. **V1 silently ignores the redirect on the non-last command** — `execPipeline` only honors `redirect` on the final command in the pipeline. So `"hello"` flows through the pipe and `cat` outputs it. `results[0].stdout == "hello"`. This is V1's silent divergence from bash; the V1 characterisation test locks this behaviour in so phase 2 cannot regress to it by accident.

Expected V2: input is rejected at parse time. Calling the tool with this input throws a Zod error whose message contains both `redirect` and `pipe`. Assertion: `await expect(call(ExecV2, input)).rejects.toThrow(/redirect.*pipe|pipe.*redirect/i)`. The phase-1 stub does not implement the refinement, so this test fails today — that failure is the phase-2 contract.

---

#### R5 — the right way to write to a file and pipe (tee idiom)

Bash: `echo "hello world" | tee /dev/null | cat`

Current Exec:
```json
{ "description": "R5",
  "steps": [
    { "commands": [
        { "program": "echo", "args": ["hello world"] },
        { "program": "tee", "args": ["/dev/null"] },
        { "program": "cat" }
    ] }
  ] }
```

ExecV2 (left-associative pipe chain):
```json
{ "description": "R5",
  "pipeline": {
    "op": "|",
    "left": {
      "op": "|",
      "left": { "id": "a", "program": "echo", "args": ["hello world"] },
      "right": { "id": "b", "program": "tee", "args": ["/dev/null"] }
    },
    "right": { "id": "c", "program": "cat" }
  } }
```

Expected V1: `success: true`. One result (V1 collapses the pipeline). `results[0].stdout == "hello world"`.

Expected V2: `success: true`. Three results. `results[0]` (id `'a'`, echo) `stdout == ""` (consumed by pipe), `exitCode == 0`. `results[1]` (id `'b'`, tee) `stdout == ""` (its stdout was consumed by the next pipe stage), `exitCode == 0`. `results[2]` (id `'c'`, cat) `stdout == "hello world"`, `exitCode == 0`.

---

#### NE1 — bare `&` with no right operand (schema rejection)

Every `Operation` requires `right`. An `&` with no `right` field is rejected by the schema.

Current Exec: not expressible. No V1 test.

ExecV2:
```json
{ "description": "NE1",
  "pipeline": {
    "op": "&",
    "left": { "id": "a", "program": "echo", "args": ["a"] }
  } }
```

Expected V2: input is rejected at parse time. The required `right` field is missing, so Zod throws an `invalid_type` / `Required` error at path `["pipeline", "right"]`. Assertion: `await expect(call(ExecV2, input)).rejects.toThrow(/right/i)`. This test passes today against the phase-1 stub (the schema already enforces required `right`).

---

#### NE2 — `stdin` literal on a right-of-pipe Command

Current Exec: V1 allows this. `execPipeline` only writes `stdin` for the first command; `stdin` on a non-first command is silently dropped.

Current Exec:
```json
{ "description": "NE2",
  "steps": [
    { "commands": [
        { "program": "echo", "args": ["hello"] },
        { "program": "cat", "stdin": "ignored" }
    ] }
  ] }
```

Expected V1: `success: true`. One result. `results[0].stdout == "hello"` (the pipe delivers echo's output to cat; cat's literal `stdin` is dropped).

ExecV2:
```json
{ "description": "NE2",
  "pipeline": {
    "op": "|",
    "left": { "id": "a", "program": "echo", "args": ["hello"] },
    "right": { "id": "b", "program": "cat", "stdin": "ignored" }
  } }
```

Expected V2: input is rejected at parse time. Assertion: `await expect(call(ExecV2, input)).rejects.toThrow(/stdin.*pipe|pipe.*stdin/i)`. The phase-1 stub does not implement the refinement, so this test fails today — phase 2 makes it pass.

---

#### B1 — blocked command (validation layer)

V2 inherits V1's `builtinRules`. Any Command leaf whose `program` trips a rule causes the whole tree to fail upfront, without executing anything.

Current Exec:
```json
{ "description": "B1",
  "steps": [{ "commands": [{ "program": "rm", "args": ["-rf", "/tmp/whatever"] }] }] }
```

ExecV2:
```json
{ "description": "B1",
  "pipeline": { "id": "a", "program": "rm", "args": ["-rf", "/tmp/whatever"] } }
```

Expected V1: `success: false`. One synthetic result. `results[0].stderr` contains `"BLOCKED"` and `"no-destructive-commands"`.

Expected V2: `success: false`. One synthetic result with the same shape. `results[0].stderr` contains `"BLOCKED"` and `"no-destructive-commands"`.

---

#### ER1 — command not found (standalone)

Bash: `definitely-not-a-real-command-xyzzy-abc`

Current Exec:
```json
{ "description": "ER1",
  "steps": [{ "commands": [{ "program": "definitely-not-a-real-command-xyzzy-abc" }] }] }
```

ExecV2:
```json
{ "description": "ER1",
  "pipeline": { "id": "a", "program": "definitely-not-a-real-command-xyzzy-abc" } }
```

Expected (V1 and V2): `success: false`. One result. `results[0].exitCode == 127`. `results[0].stderr` contains `"Command not found"` and the program name.

---

#### ER2 — cwd not found

Bash: `cd /nonexistent/path/xyz123abc && echo hello` (returns 1 with cd error)

Current Exec:
```json
{ "description": "ER2",
  "steps": [{ "commands": [{ "program": "echo", "args": ["hello"], "cwd": "/nonexistent/path/xyz123abc" }] }] }
```

ExecV2:
```json
{ "description": "ER2",
  "pipeline": { "id": "a", "program": "echo", "args": ["hello"], "cwd": "/nonexistent/path/xyz123abc" } }
```

Expected (V1 and V2): `success: false`. One result. `results[0].exitCode == 126`. `results[0].stderr` contains `"Working directory not found"`.

---

#### ER3 — command not found inside a pipeline

Bash: `definitely-not-a-real-command-xyzzy-abc | cat`

Current Exec:
```json
{ "description": "ER3",
  "steps": [
    { "commands": [
        { "program": "definitely-not-a-real-command-xyzzy-abc" },
        { "program": "cat" }
    ] }
  ] }
```

ExecV2:
```json
{ "description": "ER3",
  "pipeline": {
    "op": "|",
    "left": { "id": "a", "program": "definitely-not-a-real-command-xyzzy-abc" },
    "right": { "id": "b", "program": "cat" }
  } }
```

Expected V1: `success: false`. One result. `results[0].stderr` contains `"Command not found"`. V1's `execPipeline` collects intermediate ENOENT errors and surfaces them via the final step's stderr with `exitCode: 127`.

Expected V2: `success: false`. Two results. `results[0]` (id `'a'`) `exitCode == 127`, `stderr` contains `"Command not found"`. `results[1]` (id `'b'`, cat) ran with empty stdin, `stdout == ""`, `exitCode == 0`. V2 surfaces the failure per-leaf.

---

#### PATH1 — path normalisation (~ and $VAR)

V1's `normaliseInput` expands `~` and `$VAR` in `program`, `cwd`, and `redirect.path` before execution. V2 mirrors this step.

Current Exec:
```json
{ "description": "PATH1",
  "steps": [{ "commands": [{ "program": "echo", "args": ["hello"], "cwd": "~" }] }] }
```

ExecV2:
```json
{ "description": "PATH1",
  "pipeline": { "id": "a", "program": "echo", "args": ["hello"], "cwd": "~" } }
```

Expected (V1 and V2): `success: true`. `cwd: "~"` was normalised to the home directory before execution, so the command ran successfully (the cwd-not-found check did not trip). To assert the normalisation more directly, use `program: "node"`, `args: ["-e", "process.stdout.write(process.cwd())"]`, `cwd: "~"`, and assert `stdout == process.env.HOME`.

---

#### CF1 — cwd per command

Bash: `(cd / && pwd)`

Current Exec:
```json
{ "description": "CF1",
  "steps": [{ "commands": [{ "program": "node", "args": ["-e", "process.stdout.write(process.cwd())"], "cwd": "/" }] }] }
```

ExecV2:
```json
{ "description": "CF1",
  "pipeline": { "id": "a", "program": "node", "args": ["-e", "process.stdout.write(process.cwd())"], "cwd": "/" } }
```

Expected (V1 and V2): `success: true`. `results[0].stdout == "/"`.

---

#### CF2 — env per command

Bash: `EXEC_V2_TEST_VAR=hello node -e 'process.stdout.write(process.env.EXEC_V2_TEST_VAR)'`

Current Exec:
```json
{ "description": "CF2",
  "steps": [{ "commands": [
      { "program": "node",
        "args": ["-e", "process.stdout.write(process.env.EXEC_V2_TEST_VAR ?? 'missing')"],
        "env": { "EXEC_V2_TEST_VAR": "hello" } }
  ] }] }
```

ExecV2:
```json
{ "description": "CF2",
  "pipeline": { "id": "a", "program": "node",
    "args": ["-e", "process.stdout.write(process.env.EXEC_V2_TEST_VAR ?? 'missing')"],
    "env": { "EXEC_V2_TEST_VAR": "hello" } } }
```

Expected (V1 and V2): `success: true`. `results[0].stdout == "hello"`.

---

#### TO1 — timeout kills a long-running command

Bash: `timeout 0.1 sleep 1` (kills `sleep` after 100ms).

Current Exec:
```json
{ "description": "TO1",
  "timeout": 100,
  "steps": [{ "commands": [{ "program": "sleep", "args": ["1"] }] }] }
```

ExecV2:
```json
{ "description": "TO1",
  "timeout": 100,
  "pipeline": { "id": "a", "program": "sleep", "args": ["1"] } }
```

Expected (V1 and V2): `success: false`. One result. `results[0].exitCode == null` (the child was killed, not exited normally). `results[0].signal !== null` (signal name is OS-dependent; assert the field is set, not the specific value). The test must complete well under 1 second.

---

#### SA1 — stripAnsi default vs preserved

Bash: `printf '\x1b[31mred\x1b[0m'` (writes ANSI-coloured `red`).

Current Exec (default `stripAnsi: true`):
```json
{ "description": "SA1-default",
  "steps": [{ "commands": [{ "program": "node",
      "args": ["-e", "process.stdout.write('\\x1b[31mred\\x1b[0m')"] }] }] }
```

Current Exec (`stripAnsi: false`):
```json
{ "description": "SA1-preserved",
  "stripAnsi": false,
  "steps": [{ "commands": [{ "program": "node",
      "args": ["-e", "process.stdout.write('\\x1b[31mred\\x1b[0m')"] }] }] }
```

ExecV2 (default):
```json
{ "description": "SA1-default",
  "pipeline": { "id": "a", "program": "node",
    "args": ["-e", "process.stdout.write('\\x1b[31mred\\x1b[0m')"] } }
```

ExecV2 (preserved):
```json
{ "description": "SA1-preserved",
  "stripAnsi": false,
  "pipeline": { "id": "a", "program": "node",
    "args": ["-e", "process.stdout.write('\\x1b[31mred\\x1b[0m')"] } }
```

Expected (V1 and V2, default): `results[0].stdout == "red"` — ANSI stripped.

Expected (V1 and V2, preserved): `results[0].stdout` contains `"\x1b["` — ANSI preserved.

#### NE3 — group on the right of a pipe (schema rejection)

Bash equivalent: not directly expressible — bash treats `a | (b; c)` as a subshell, but V2 has no subshell concept and the right side of a pipe must be a single Command leaf (so it can receive a well-defined stdin). The schema rejects this shape at parse time so Claude cannot construct it at all.

Current Exec: not expressible (V1 has no `op` concept). No V1 test.

ExecV2:
```json
{ "description": "NE3",
  "pipeline": {
    "op": "|",
    "left": { "id": "a", "program": "echo", "args": ["hello"] },
    "right": {
      "op": "&&",
      "left": { "id": "b", "program": "cat" },
      "right": { "id": "c", "program": "wc", "args": ["-l"] }
    }
  } }
```

Expected V2: input is rejected at parse time. The `right` field on the outer `|` operation is an Operation (it has an `op` field, not a `program`), so the `NE3` superRefine on `OperationSchema` fires. The Zod error carries path `['right']` and a message stating the right side of a pipe must be a single Command. Assertion: `await expect(call(ExecV2, input)).rejects.toThrow(/pipe|command/i)` — both words appear in the message. This test passes immediately against the phase-2 implementation (the schema refinement is already in place).
