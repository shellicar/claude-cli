# Orchestrate

Design notes from the session that worked this out. Captures the decided shape and the
reasoning behind it, not an exhaustive spec — fill in details during implementation.

## The problem this solves

Started from a narrow question: how do you call a function app's HTTP endpoint (or query
a DB with a key) without the credential ever landing in Claude's context? Any tool call
that returns a secret's value puts it permanently into session history, searchable,
unrevocable.

Widened from there: `AzCli`/`EscalatedAzCli` and the git tools (`feature/git-tool` branch)
share the same real flaw — not "only runs az" or "only runs git", but **only one command
per call**. That's what makes `fetch && rebase && push` or `az ... | curl ...`
inexpressible today: each is forced through either N separate round trips (Claude as the
manual glue, retyping values by hand) or falling back to `Exec: sh -c '...'`, which throws
away the whole reason typed, per-command tools exist (legibility, per-command approval,
schema-checked args).

`ExecV2` already tried a more expressive shape (a binary tree of `; && || & |`) and it
failed in practice: too easy for Claude to build wrong, so it reverted to `sh -c '...'`
anyway. Expressiveness that can't be used correctly is worse than no expressiveness — it
becomes an escape hatch back to the unstructured, illegible shape everything else here
exists to avoid.

## What Exec is actually for

Not defense against Claude as an adversary — sandboxing is the real mechanism for
that, and it's a separate, unbuilt concern. Exec's structured `program`/`args` (vs a raw
shell string) exists so what's about to run is **legible**: checkable by a block-list,
inspectable by whoever approves it, reconstructable in an audit log afterward. `sh -c
'...'` defeats that by smuggling an entire script inside one opaque string argument.
Env var expansion, capture, etc. don't reopen that hole — they don't hide anything from
the block-list the way `sh -c` does.

## Shape: two fixed levels, not a flat list, not a tree

`Orchestrate` reuses `ExecV3`'s proven flatness, but structures it in two fixed levels
rather than one flat list relying on bash-style precedence to be inferred correctly.
`a && (b | c | d) || e` in `ExecV3` already parses to the intended grouping today (`|`
binds tighter than `&&`/`||`, same rule as bash) — but that's precedence a caller has to
get right mentally, and precedence bugs are a well-worn source of real shell mistakes.
Instead:

```
[
  { commands: a,         operator: '&&' },
  { commands: b | c | d, operator: '||' },
  { commands: e },
]
```

An outer sequence of blocks joined by `;`/`&&`/`||` (control flow — gates on success or
failure), each block itself a flat pipe chain (data flow — output feeds the next stage).
This is still bounded at exactly two levels, not a recursive tree — it doesn't reopen the
ExecV2 problem (arbitrary nesting depth was the actual failure there, not "more than one
level" per se). The two kinds of composition are fundamentally different in what they
mean (data vs control), so representing them as two distinct structural levels instead
of one flat list with mixed meaning is more honest to what's actually happening, not
just more convenient.

No tree beyond this fixed two-level shape. Loops and value-based branching were
considered and rejected for the same reason: when logic like that is actually needed,
the right move is a real script file, not more expressiveness bolted onto ad hoc tool
calls. In practice these have essentially never come up as needs in ad hoc (non-scripted)
use.

The exact wire shape (JSON blocks-with-operator, a flat array with inline `pipe` groups,
or even a text/DSL syntax — a simplified "bash-lite") is surface syntax, not settled
here. It's swappable later without touching anything that actually matters: the target/
content split, capture+reference, env scrubbing, the two-layer approval model, and the
streaming requirement below. Scratch-tested two JSON variants for size/legibility during
this session; a flat array where an item is either a plain command or a `{ pipe: [...],
op }` group came out both smaller and more legible than a uniform blocks-with-operator
wrapper — worth defaulting to that unless implementation surfaces a reason not to.

`Orchestrate` supersedes `Pipe`. Two separate composition mechanisms in the same
catalogue is complexity with no payoff — `Pipe`'s six stages (Find/Read/Match/Head/
Tail/Range/Paths) become ordinary operations in one `Orchestrate` sequence, alongside
everything else.

`ExecV3`/`ExecV2` collapse into a single leaf kind: **`Program`** — spawn one process,
bytes in, bytes out, no special composition logic of its own (that's now `Orchestrate`'s
job, uniformly, for every leaf, not just processes).

## Composability is not "make everything text"

Considered and rejected as the general mechanism. `Match`'s own code
(`packages/claude-sdk-tools/src/Match/Match.ts`) shows why: its behaviour branches on
`input.kind` (`'files'` vs `'content'`) — same tool, same pattern, different meaning of
"match" depending on what produced the input. That's *polymorphism*, and it's the
opposite of how real Unix composability works: `grep` has zero awareness of what a line
of text represents, it just matches, uniformly, regardless of provenance. Because our
existing composable tools already commit to a typed JSON `Stream` (not bytes), text
isn't an available fallback substrate for them without a real adapter/conversion step —
and a generic conversion node only works for flat-list shapes (a file path), not for
richer structured shapes (a diagnostic, a line edit), where it either forces a fragile
ad hoc text convention or collapses back into "the consumer has to know the shape",
i.e. no real gain over what typed tool calls already give you.

Conclusion: don't chase a universal wire format. Instead—

## The real per-tool design rule: target vs content

Every tool that participates in `Orchestrate` splits its fields into two categories:

- **Target** — decides *where* an effect lands or *which* fixed operation runs (a file
  path, a PR number, `program`, `cwd`, a redirect target). Must stay an explicit,
  literal argument in the call — visible to review, never dynamically resolved or
  expanded. This is the same legibility principle as not letting `program` be built
  from a variable.
- **Content** — the data a tool consumes or produces that can legitimately come from
  elsewhere (already exists in a file, was generated by a prior step, etc). This is
  the channel that can be satisfied by piped input instead of a literal argument,
  using **that tool's own natural convention** — not a shared universal schema. E.g.:
  - `CreateFile`: `file` stays explicit; `content` can come from stdin (the whole
    file's new text) — real, because sometimes I don't already have the content
    myself (a fetched artifact, generated output).
  - `DeleteFile` / `git rm` / `git mv * dest`: explicit list normally; a piped list
    of paths is the equivalent of `find | xargs rm`. Only holds when the operation
    takes one flat list — `git mv` with per-source distinct destinations does *not*
    fit this (it needs a correlated pair, not a list), so it stays point-shaped.
  - `ReadFile` (text): same batch-list shape (`find | xargs cat`) — genuinely useful,
    I already do this by hand across separate calls today.
  - `ReadBinaryFile` (PDF/image): **must stay a completely separate tool**, single
    target only, never fed by a pipe. Not a type/format distinction — a blast-radius
    one: piping a large discovered list into a text reader is cheap and reversible;
    piping it into a binary reader means N PDFs/images actually get decoded into
    context as native blocks, expensive and irreversible. Making this one tool with
    a mode switch (piped ⇒ text-only, direct ⇒ any mimeType) was considered and
    rejected — that's exactly the kind of hidden, invocation-dependent behaviour
    branch (like `Match`'s `input.kind`) that this whole design is trying to avoid;
    the risk needs to be visible in the tool's *name*, not buried in a runtime rule.
  - `WriteMemory` / PR `body` / commit message: content channel is real whenever the
    text already exists elsewhere (a template, a file I want to review before
    committing, a generated summary) — NOT ruled out by "this content should be
    deliberately authored". Authorship is about care taken composing it, not about
    which mechanism delivered it into the argument.
  - Point-shaped tools with **no** content channel and no batch-list form: `TsHover`/
    `TsDefinition`/`TsReferences`/`ReadMemory`(by id)/`MemoryTypes` — a specific
    coordinate or id, same as `git status`. Nothing to pipe in.
  - **Recurring pattern across the whole catalogue**: source (`Find`, `SearchMemory`,
    `SearchHistory`, `Git_BranchList`, `Git_StashList`, `az ... list`) → batch
    consumer of what would otherwise be one explicit id/path/target at a time
    (`DeleteFile`, `ReadMemory`, `ReadFile`, `Git_StashApply`/`Drop`, `az ... <cmd>`
    via `xargs`-equivalent). Shows up independently at least three times — treat it
    as a first-class, deliberate shape, not a one-off per tool family.
  - **Piping into a tool that doesn't consume input is an error, not a silent
    no-op.** Real Unix goes implicit (`echo hi | ls` just runs `ls`, ignoring
    stdin) because a human watches the result live and notices immediately if it
    didn't do what they meant. Claude doesn't get that same live signal — a silent
    no-op returns a normal-looking result and Claude can walk away believing
    something happened that didn't. Erroring surfaces exactly the mistake that
    matters: a wrong assumption about what a tool does with what it's handed.

## Requirement: piping must be streamed, not buffered

`ExecV3`'s `Program`-to-`Program` pipes are true OS-level streams — proven by `yes | head
-1` terminating at all (only possible because `head` closing its end sends `yes`
SIGPIPE) and by `echo | head` showing the first command's stdout never even reaches
`results[0]` for the parent process. `Pipe`'s existing composable stages are not: `Match`
operates on `input.files.filter(...)`, a fully realized array — Find/Read/Match/Head/
Tail/Range already buffer completely between each stage. That means `Pipe`, as it works
today, is not fit for purpose as the model for `Orchestrate`'s `|` — it cannot short-
circuit a producer (`find ~ | head -1` would have to finish walking the whole tree
before `head` ever sees anything).

This is a hard requirement for `Orchestrate`, not an open question: `|` between any two
leaves — `Program` or `ToolCall`, in any combination — needs genuinely streamed data,
not a fully materialized array handed forward once a stage completes. It doesn't need to
be a real OS pipe (that's specific to spawned processes) — it can be faked with an async
iterable/generator between stages in our own orchestrator code — but the semantics have
to hold: a downstream stage that stops early (`Head`) must be able to cut a producer
short rather than forcing it to run to completion first.

## Skill is excluded entirely

Not point-shaped, not source/sink/transform — loading a skill changes what
constraints govern Claude itself, self-referential, not data flowing through a
pipeline. It doesn't fit the model at all and shouldn't be forced into it.

## Credentials: composability + capture solves the passing problem; context stays a live option

Originally sketched as a declared `context: [{ type: 'az', privileged: true }]` list,
referenced per-operation, to amortize escalation approval across a sequence. Proven
unnecessary *for the credential-passing case specifically* — composability + two small
primitives already solve that for free, once `AzCli` is just another orchestratable step
instead of a single isolated call:

```
AzCli: get the secret key            (captures output, e.g. to a named value)
Program: curl ... (references the captured value in an argument or env var)
```

Two primitives needed, not a whole context system:

1. **Capture** — a command's stdout can be held as a named value for later reference.
   Bash's own version of this (`cmd | read x`, subshell-scoping) is a known trap
   (`read` runs in a subshell, the variable vanishes) — ours should be first-class
   and not inherit that bug.
2. **Reference/expansion in arguments (and `env`, reusing the field ExecV3 already
   has) only** — never in `program`, `cwd`, or a redirect *target* path, because
   those decide where an effect physically lands and must stay literal/legible in
   the call itself, same reasoning as not letting `program` be dynamic.

The secret's raw value is never shown to Claude — review/approval shows the
**unexpanded reference** (`Authorization: Bearer $TOKEN`), never the resolved value.
That's sufficient for informed consent: the reviewer is approving the *shape* of the
operation (a captured value gets used as a bearer token here), not the literal bytes,
same as approving `sudo apt install` without seeing the password.

The `context` idea isn't discarded, though — it's a live option for a different reason:
if `Orchestrate` itself can carry an escalation context per-operation, that may remove
the need for dedicated tools that exist *purely* to represent an escalation tier (e.g.
`AzCli` vs `EscalatedAzCli` as two separate tools just to draw that boundary). An
`Orchestrate`-level `context` could be the escalation mechanism itself, which is a
separate justification from credential-passing and worth keeping on the table. This
design is meant to provide more options, not force a single conclusion.

## The actual credential-exposure fix: env scrubbing at spawn, not blocking `$VAR`

Early framing was wrong: "Exec doesn't do shell expansion, and that's a deliberate
security boundary against injection." Disproven directly — nothing stops
`program: "sh", args: ["-c", "rm -rf /"]` today, so "no shell interposed" was never a
real boundary; a shell is one argument away regardless. So `$VAR`-only expansion
(literal name lookup, no shell parsing, no globbing/command substitution) doesn't
reopen anything that wasn't already open.

The actual control needed is a **different axis entirely**: what environment a spawned
process receives in the first place. Today `runGit`/`ExecV3` inherit the full parent
environment (`env: process.env` in `runGit.ts`), which means any expansion or even a
bare `env` call hands over whatever's ambient — Stephen's own tokens, `$TMUX_PANE`,
anything — not because expansion is unsafe, but because inheritance is unscoped. Fix:
scrub the specific env vars that shouldn't be inherited before spawning, rather than
trying to prevent expansion of env vars. This is the same pattern `keychain-native`/
`AzCli` already use for the az login identity — generalise the scrubbing, not a
blanket deny-all-inheritance policy.

This is a **separate concern from building `Orchestrate`**, not a prerequisite for it —
whether env vars are scrubbed or not doesn't gate anything below. Worth doing on its own
merits, whenever, independently of this work.

## Approval: two layers, not one

1. **Static deny** — same as the existing `safe-operations` hard blocks (`rm`,
   `sed -i`, `git reset --hard`, etc). Deterministic, pre-execution, no judgement call
   reachable at all — there's no point asking someone to approve something the system
   won't allow anyway; that's a useless approval, not a safety measure.
2. **Per-command approval** — happens when a specific operation in the sequence is
   about to run, seeing *that operation's* real resolved shape (e.g. the actual file
   list `Find` produced), not the whole pipeline's source text approved blind up
   front. The approval channel is already a separate audience from Claude's context
   (the consumer/SC slots in as approver via a held-promise) — so a resolved
   captured value can be shown to the human approver without ever entering Claude's
   context, if that's ever needed. In practice, per the reference/expansion point
   above, review only needs the unexpanded reference anyway.

## Operation tiers are `fs.*`, with `list` and `exec` added

The existing `ToolOperation` type (`'read' | 'write' | 'delete' | 'escalate'`) is really
about filesystem permissions and should be named that way — `fs.read`, `fs.write`,
`fs.delete` — plus two tiers that were missing:

- **`fs.list`** — reading a directory's entries. `Find` is this, not `fs.read`. Real Unix
  keeps this distinct from file content (`r` on a directory lists entries; `r` on a file
  reads content) — conflating the two was the mistake in an earlier pass of this doc,
  where `Find` got called a `'read'`-tier tool.
- **`fs.exec`** — executing a program (`Program`/`ExecV3`'s spawn). Real Unix's `x` bit on
  a file. Was previously unrepresented as its own tier at all.

`fs.delete` stays its own tier rather than being folded into `fs.write`-on-a-directory
(which is how Unix actually models a delete) — simpler to keep it explicit for our
purposes than to make every consumer reason about "write, but scoped to the parent
directory." `escalate` stays outside the `fs.*` set entirely, since crossing a privilege
boundary isn't a filesystem operation.

## Buffering is conditional on approval, not a fixed tool property

Approval always covers exactly what was piped into a stage, in whatever shape that
naturally is — not a special case per operation tier. `Find` (`fs.list`) piped into
`ReadFile` (`fs.read`) or `DeleteFile` (`fs.delete`) both approve a resolved list of file
targets ("read/delete these N files") — same shape, same cost, cheap to buffer (a path
list, not content).
`Something → EditFile`/`CreateFile` approves resolved *content*, because that's what's
piped into them. In the ordinary case, read/write/delete are symmetric: buffer what was
piped in, present it, then act.

The one genuinely hard case is narrower than "read in general": `ReadFile` piped into a
downstream stage whose demand is *content*-derived, not file-count-derived — e.g.
`Find → ReadFile → Head -N` where `Head` counts lines. The correct number of files needed
depends on each file's actual line count, which is only discoverable by reading it — so
the resolved scope genuinely cannot be known before some reading has already happened.
That's a property of this specific combination (a file-shaped producer feeding a
content-shaped consumer), not a general fact about `'read'` as a tier.

**What actually drives whether a stage buffers is not efficiency — it's whether an
approval gate sits in front of it.** A gate needs something resolved to show, so a gated
stage must buffer before it can present anything. An ungated stage (already trusted for
this run) doesn't need to buffer, because nothing needs to be shown before it acts.
Buffering `DeleteFile`'s path list or `CreateFile`'s content isn't wasteful the way
buffering `ReadFile` ahead of `Head` would be (nothing downstream could have made that
work unnecessary), but that was never actually the reason to buffer or not — the reason
is purely whether a gate is present.

Which stages are gated is decided by which approval tier was granted for that specific
orchestration run, live — not fixed per tool. `find /tmp/my-temp-dir | xargs rm`
approved at `approve: delete` (broad, pre-trusted) means no gate sits in front of the
delete stage — nothing to show, it can stream straight through. The same shape,
`find ~/repos/... | xargs rm`, approved only at `approve: read` (narrower — trusting the
enumeration but not pre-committing to the delete) means a gate *does* sit in front of the
delete stage, so it must buffer to have the resolved file list to present before it can
act. Same tool, same shape, different buffering behaviour on different runs, determined
by what's already been trusted for that run — not hardcoded into the tool.

## Known adjacent bug (separate from Orchestrate, worth fixing regardless)

`GitHub_PullRequest_Ready`/`AutoMerge`/`Comment`/etc. require `number` today. The
underlying `gh pr` commands infer the current PR from the current repo/branch when no
number is given. Requiring it is stricter than necessary and is exactly what manufactures
a need to pipe the number forward from `Create` in the common one-PR-per-branch case.
Fix independently: make `number` optional, inferred from context, matching `gh` itself.

## First implementation steps (in order)

1. Capture + reference/expansion primitive (new field(s) on `Orchestrate`'s
   `Program`/`ToolCall` operations) — scoped to `args`/`env` only.
2. `Orchestrate` itself: flat sequence (exact wire shape TBD during implementation,
   see above), operations are either `Program` (the `ExecV3`/`ExecV2` successor) or a
   `ToolCall` (any existing `defineTool`/`defineComposable` tool, including the current
   `Pipe` six and the `Git_*` family on `feature/git-tool`).
3. Migrate `Pipe`'s six stages and the `Git_*` tools onto `Orchestrate` as ordinary
   operations; retire `Pipe`, `ExecV2`, `ExecV3` as separate tools once `Orchestrate`
   covers their cases.
4. Split `ReadFile` into a batchable text reader and a separate, single-target
   `ReadBinaryFile`.
5. Fix the GitHub/AzureDevOps `number`-required bug (independent, can land any time).

Env scrubbing at spawn time and the `context`-as-escalation-mechanism idea are both
separate, independent concerns — not sequenced here, not a prerequisite for anything
above.


## This is Tools V2, not a new tool bolted onto the current system

The streaming requirement above doesn't stop at `Pipe`'s six stages. **Any** tool that
wants to participate in `Orchestrate` at all — accept piped input or be piped into —
needs to be built against a streaming interface from the start, not "receives a fully
materialized value." That's not a migration task tucked inside implementation step 3
above; it's a foundational interface requirement the whole tool catalogue would need to
satisfy. Looked at the actual foundation this rests on — `defineTool`, `ToolRegistry`,
`ApprovalCoordinator` — and the "one tool call = one resolve = one run = one approval"
model is structural, not incidental: `ToolRegistry.resolve()` parses input once and
returns a `run` closure that calls the handler once for a single result;
`ApprovalCoordinator` tracks exactly one `AbortController` and one pending-approval
promise per tool call, with no concept of a call containing several sub-operations each
needing their own approval moment.

So this is genuinely **Tools V2**: `defineTool`'s shape, tool registration, approval,
and permission gating all get redesigned, not just a new tool added beside the old ones.

**Decision: build it as a fully separate system, not intertwined with the current one.**
Retrofitting streaming/capture/per-command-approval into the existing `ToolRegistry`/
`ApprovalCoordinator` in place would mean changing the meaning of "a tool call"
everywhere at once, while every existing tool (and its approval UI, its tests) still
depends on the current one-shot meaning — a long half-broken period with no working
fallback. Building V2 alongside V1 — its own `defineToolV2`, its own registry, its own
approval flow — matches this codebase's own precedent: `Exec` → `ExecV2` → `ExecV3`
already coexist today, with `ExecV2` simply present-but-disabled rather than replacing
`Exec` in place. Lets migration happen tool-by-tool (or not at all, for tools with no
reason to move) instead of one big-bang cutover.

**Where the two systems necessarily still touch**, because Claude only ever sees one
flat tool list and one tool-call protocol, no matter how many systems sit behind it:

1. **The wire tools list** (`IToolRegistry.wireTools`, feeding the Anthropic API's
   `tools` param) — V1 and V2 tool definitions have to merge into one array; there is
   no way to present two separate tool universes to the model itself.
2. **Dispatch** — when a `tool_use` block comes back, something has to decide whether
   the name belongs to the V1 registry or the V2 engine and route accordingly (today,
   `registry.resolve(name, input)` in `QueryRunner` assumes a single registry).
3. **Tool rendering** — the TUI block showing "Claude called X, here's the result"
   needs to render both a V1 tool's single result and a V2 orchestrated sequence's
   multi-stage result in one consistent visual language, or the SC sees two visually
   different tool-call experiences depending on which system happened to run.
4. **Approval UI** — likely the same underlying component for both, but V2's per-
   command approval (seeing one operation's resolved shape mid-sequence, not the whole
   call up front) is a genuinely different interaction shape than V1's single yes/no;
   this is where actual new UI design is needed, not just a shared pipe.

Wire-list merge and dispatch are small and mechanical. Tool rendering and approval UI
are where the real design work is, because V2's approval/result shape is fundamentally
richer than V1's single request/response.