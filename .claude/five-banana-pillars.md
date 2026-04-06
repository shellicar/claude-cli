# The Five Banana Pillars

The SDK is the runtime that all five pillars bolt onto.

**The core insight:** the official Anthropic SDK is a black box. `@shellicar/claude-sdk` makes the agent loop transparent — and that transparency is what enables everything else.

Without owning the agent loop, you cannot manage context (The Case), track costs (The Cage), route messages (The Mailroom), emit events (The Tower), or control tool execution (The Pit). Every pillar requires visibility into what the loop is doing.

---

## The Five Pillars

**The Case — Context Management**
The SDK owns the messages array. It controls what enters context, manages compaction, and exposes push/remove for tagged pruning. The consumer saves, loads, and edits. Compaction is the consumer editing the array. Long-term: tiered context model — small results inline, old results pruned, important results stored for recall.

**The Cage — Cost Visibility**
The SDK streams usage data per turn: input tokens, output tokens, cache read/write. The consumer tracks and displays however they want. Without owning the loop, per-turn costs are invisible — you get a total at the end, nothing you can act on mid-session.

**The Mailroom — Orchestration**
The `MessageChannel` is the mailroom. Bidirectional SDK/consumer communication over a typed message protocol. Multi-agent orchestration: each agent exposes the same interface; the orchestrator speaks one protocol to all of them.

**The Tower — Observability**
The SDK emits events: tool calls, approvals, cost deltas, context usage, errors. The Tower slots in as the approver via the held-promise pattern — no SDK changes needed. Observability is a consumer concern; the SDK just emits faithfully.

**The Pit — Sandbox**
The SDK runs inside whatever environment the consumer provides. The tool pipeline (validate → approve → execute) is what makes the pit safe. The consumer controls which tools exist and whether each invocation is allowed.

---

## How the pillars guide architecture decisions

When a design question comes up, run it against the pillars:
- Does this decision keep the messages array transparent and editable? (The Case)
- Does this decision make per-turn costs visible to the consumer? (The Cage)
- Does this decision keep the message protocol clean and consistent? (The Mailroom)
- Does this decision emit enough events for the consumer to observe what's happening? (The Tower)
- Does this decision keep the consumer in control of tool execution? (The Pit)

If a decision serves none of the pillars, it probably doesn't belong in the SDK.
