# Skills Design

## What Skills Are

A skill is a named, toggleable capability package. Each skill has three parts:

1. **Content** — a `SKILL.md` body injected into context when the skill is active
2. **Gates** — optional: tools or permissions the skill enables (soft-locked otherwise)
3. **Lifecycle** — `alwaysOn`, or activated/deactivated by Claude via meta-tools

Skills are not passive documentation. They are active context with a managed lifecycle.

---

## The Two Meta-Tools

Claude has two special tools that are not gated by any skill:

- **`ActivateSkill(name)`** — injects the skill's `SKILL.md` as a tagged context message; lifts any gates the skill enables
- **`DeactivateSkill(name)`** — prunes the injected context message; re-applies gates

Claude invokes these autonomously. The user can also trigger them by instruction. The consumer can also manage lifecycle directly (always-on skills, phased workflows).

---

## Gating

Gated tools are not removed from the tool list — Claude can still see they exist. Attempting to call a gated tool without the required skill returns a soft decline:

> `git-commit skill must be active to use git. Call ActivateSkill("git-commit") first.`

This is intentional. Claude needs to know the tool exists in order to plan around it. The message guides Claude to activate the right skill before proceeding.

When a skill is activated, its `SKILL.md` enters context as the tool result — meaning the workflow guidance is guaranteed to be in context at the exact moment the gated tools become available. This is the key reliability property: the workflow cannot be bypassed because the tools aren't accessible without it.

Gating is optional. A skill that has no gates still has value as managed context — it's injected when relevant and pruned when done, rather than loading everything upfront.

---

## Why This Looks Like Restriction But Isn't

The surface reading: tools are locked behind skills, Claude has to ask permission to use them.

The actual effect: **Claude is given structured autonomy over its own capability set.**

Today, Claude has access to every tool at all times. It has to make do with a static toolset and a static context regardless of what it's actually doing. A session doing exploration and a session doing git commits look identical to the model.

With skills, Claude can:
- Recognise what phase of work it's in
- Self-activate the relevant capability package
- Work within a well-defined scope for that phase
- Deactivate when done, keeping context clean

The skills system doesn't restrict what Claude can ultimately do — it gives Claude the ability to shape its own working environment. That's more autonomy, not less. The structure is what makes it trustworthy.

The analogy: a contractor who scopes their own work, requests the right tools for each job, and puts them away when done is more capable than one who shows up with every tool they own and leaves them all out. The discipline is what enables the trust.

---

## The Compliance Problem This Solves

The problem with pure prompt-based skills: Claude can decide a skill isn't necessary and skip it. No matter how forceful the language, it's a suggestion. This means skills cannot enforce workflow or policy — they can only recommend it.

The root cause isn't Claude being uncooperative. Claude doesn't have a compliance problem. It has a context problem: without a structural signal, it can't always know that following a workflow is more important than any given shortcut it might take.

Gating provides that structural signal. When a skill must be active for a tool to be usable, the workflow isn't a recommendation — it's the path. The guidance in `SKILL.md` is loaded at the moment it's most relevant, not beforehand as ambient context that might or might not be attended to.

---

## Phased Workflows

Different phases of a job need different capability sets:

| Phase | Likely active skills |
|---|---|
| Exploration / design | (minimal — maybe detection or style skills) |
| Development | `tdd`, `typescript-standards` |
| Commit / push / PR | `git-commit`, `github-pr`, `writing-style` |
| Azure ADO work item | `azure-devops-pr`, `work-item-hygiene` |

These aren't hardcoded. The consumer decides which skills exist and how they're structured. A skill that's always-on for one workflow is optional in another.

---

## SDK Boundaries

The SDK provides primitives. It does not provide opinions about which skills exist or how workflows are structured.

**SDK provides:**
- `ConversationHistory.push(msg, { id? })` — tagged message injection
- `ConversationHistory.remove(id)` — surgical message pruning (enables deactivation)
- Skill activation/deactivation event types on the message channel
- Enough scaffolding for `ActivateSkill`/`DeactivateSkill` to be buildable as regular tools

**Consumer / package provides:**
- The actual skill definitions (`SKILL.md` content, gate declarations)
- The `ActivateSkill`/`DeactivateSkill` tool handlers
- Which tools require which skills
- Workflow phase configuration, always-on policy

A reference implementation will live in `packages/claude-sdk-tools` or a dedicated `packages/claude-sdk-skills`. The consumer can use it as-is, adapt it, or replace it entirely.

The Ref system follows the same boundary: the SDK owns the history primitive that makes it possible, the consumer decides what to store and when to retrieve it.

---

## Minimum SDK Work Required

The only SDK change needed to support this fully:

```
ConversationHistory.push(msg, { id? })   →  tagged injection
ConversationHistory.remove(id)           →  pruning on deactivate
```

Tool gating requires no SDK changes — it's plain handler logic that returns a guidance message. The meta-tools themselves are plain `defineTool()` calls. The skill content entering context on activation is the tool result of `ActivateSkill` — no special injection mechanism needed for that direction.
