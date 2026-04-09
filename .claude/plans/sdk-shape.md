# SDK shape

## The why

Two underlying problems drove this rewrite. Neither was written down the first time, so later work drifted towards symptoms instead of the actual constraint. Everything else in this document is consequence of those two problems.

### Problem 1: nothing was durable across queries

The SDK was originally designed without any concept of a session, to avoid the kind of persistence the official Claude Code SDK owns (session ids, session files, resume-by-id). Avoiding that persistence was correct. Avoiding it by refusing to have a session object at all was wrong. A clean design still needs the concept of a session: something that holds state across queries and turns for the life of the process. What it does not need is any ability to save or restore that state to or from disk.

The consequence was that every call to run an agent had to reconstruct the full context from scratch: model, tools, betas, system prompts, cache settings, transform hooks, cached reminders, all of it. A caller-supplied object graph with roughly fifteen fields, of which maybe two actually changed between calls. That is not "avoiding persistence". That is making the consumer rebuild SDK state the SDK should have been holding in memory.

The correct rule is "no persistence or hydration of a session". Not "no session". The SDK can have a session object. It holds state for the life of the process. It does not read or write it to disk. If the consumer wants to resume across processes, the consumer reads the conversation out of the session, saves it, and on next startup constructs a fresh session and pushes the messages back in. The SDK knows nothing about that flow.

### Problem 2: the SDK was touching files

`ConversationStore` knows about history file paths. `AnthropicAgentOptions.historyFile` forces every consumer to opt in to SDK-managed persistence. The audit branch was adding a `RawEventWriter` and an `AuditWriter` that call `mkdirSync` and `appendFileSync` from inside the SDK. All of that is wrong. The SDK is an API client library. It should not know what a filesystem is. Every file path, every `fs` call, every "where does this go" decision lives in the consumer.

These two problems are the whole reason for this rewrite. If a later decision contradicts them, it is wrong and we back it out.

## What we want the SDK to be

The SDK is a kit of modular parts that a consumer composes into an application. Consumers can:

- Use the default assembly and get a working agent.
- Replace any piece with their own implementation of the same responsibility.
- Reach into the pieces directly to read state, edit the conversation, tap events.

These three modes are not layered "beginner / intermediate / advanced" APIs. They are the same API viewed from different heights. Nothing is hidden.

### Principles

**Substitution, not optionality.** Composability means you can replace a building block with your own. It does not mean every building block ships an on/off switch. The defaults are the full feature. If you do not want the default, you drop in your own. We do not degrade the defaults to offer "lite" versions.

**Substitution happens through behavioural interfaces.** Each building block is defined by an interface (or abstract class) whose behavioural contract is stated in prose on the type itself. Concrete classes implement the interface. A consumer substitutes a block by writing their own implementation of the same interface, and the contract tells them what a correct implementation must do: on success, on error, on cancel, on partial data, on out-of-order events. Liskov substitution applies. "Same shape" at the type level is not sufficient. The contract is behavioural, and it lives on the interface, not only in this document.

**Not every helper is a building block.** The named blocks in this document are the block-level identities and substitution surfaces. Helpers, utilities, and internal collaborators that live inside a block are wiring, not building blocks in their own right. Composability is the design goal for the blocks, not an obligation for every file.

**The SDK understands the API. It does not understand the filesystem.** The SDK knows about Anthropic's message rules, compaction semantics, cache markers, streaming shapes. It does not know about paths, files, sessions, session ids, audit logs, or where anything lives. Those are consumer concerns.

**Config describes usage, not API shape.** The consumer says what feature they want turned on and how they want it to behave. The SDK works out the API-level details of how to turn it on: the beta header, the field name on the request body, the accepted value range, the places cache markers have to appear. The consumer should not have to know that enabling server compaction requires a specific beta flag to be set on the headers and also a specific field to be populated on the body. They say `compaction: { enabled: true, inputTokens: 100000, pauseAfterCompact: true }`, and the SDK emits both the header and the body field. Thinking, cache TTL, cached reminders, tool approval, and every similar feature follow the same rule: one grouped option per feature, named after the feature, populated with the things the consumer actually cares about. A raw `betas` field still exists as an escape hatch for features the SDK does not yet understand, but it is the exception, not the primary surface.

**Two-way messaging over `MessagePort` is wiring, not wrapping.** The port exists because the SDK's default control blocks (approval, cancel) need bidirectional, id-correlated message exchange without every call site sprouting callbacks. It is part of the default assembly. If a consumer replaces the blocks that use the port with their own, the port goes away with them. We do not frame the port as an optional wrapper around something else. It is the mechanism the default coordinators use.

**Observation and control are separate surfaces.** Read-only observation (raw events, assembled messages, deltas, lifecycle) happens through event taps on the query handle. Control (approvals, cancel) happens through the port. Different jobs, different surfaces, no coupling.

**The consumer owns the conversation.** `Conversation` is a building block, not a private implementation detail. The SDK pushes messages into it according to API rules. The consumer can also push, remove, replace, read, whatever. Closed for modification (we do not grow new SDK methods every time the consumer wants to do something new); open for extension (the consumer composes with the primitive directly).

## The building blocks

Named provisionally. Focus is responsibility, not name. Where "the consumer" appears below, read it as "whatever code uses this SDK", which today means the CLI but should work for any consumer.

**Client.** Talks to the Anthropic API. Owns authentication (token acquisition, OAuth flow, token refresh), HTTP transport, and transport-identifying headers (user-agent, SDK version). It does not decide what goes in a request: it takes a fully-formed body and a fully-formed header set from the request builder and sends them. The feature-level beta headers (compaction, thinking, extended cache TTL, and so on) are chosen by the request builder from the session config, not by the client. The client is the pipe, not the policy. One instance per process. Stateless with respect to conversations. You hand it a token source and it gives you the ability to make authenticated API calls. No other block makes HTTP calls. Credential storage is the one pragmatic exception to the "SDK does not touch files" rule: reading and writing the auth tokens file is access to the API, not state from or to the API. The OAuth flow itself (redirect, code exchange, refresh protocol) is fully inside the Client block's responsibility.

**Conversation.** Holds the in-memory message list and is the authority on what a valid conversation looks like. Knows alternation, compaction semantics, cache boundaries. Provides: push, read-full-history, read-wire-view (deep-cloned, trimmed to last compaction, cache-annotated, safe to mutate without corrupting storage), direct operations (remove by id, replace, insert, clear). No IO of any kind, ever.

**Stream processor.** Consumes an async iterable of raw Anthropic stream events and produces meaningful output. This is where the SDK "understands the API". Responsible for parsing deltas into blocks, tracking per-TTL cache split, tracking iterations, tracking stop reason and context management, assembling the final non-streaming-shaped message on completion. Provides: pass-through of raw events, semantic deltas (text, thinking, tool input), per-block and per-message lifecycle, the assembled final message object. The consumer picks which of those they care about. Raw for replay, assembled for audit, deltas for live UI.

**Request builder.** Pure function. Given a config and wire-view messages, returns a request body and a header set. This is the block that cashes out the "config describes usage, not API shape" principle: usage-level config (compaction, thinking, cache TTL, cached reminders, tool schemas, system prompts) is translated here into the combination of body fields, `cache_control` markers, and `anthropic-beta` header values the API actually requires. If an escape-hatch raw `betas` value is present, it is merged in on top. Stateless. Not a class unless there is a reason.

**Tool registry.** Holds tool definitions and executes them. Validates input against the schema, calls the handler, formats the result as a `tool_result` block, runs the optional result-transform hook. Knows nothing about approval. Knows nothing about conversations. Just a callable catalog.

**Approval coordinator.** Correlates outbound approval requests with inbound responses by id. Sends the request on the port, parks the pending state, resolves when the matching response arrives. Propagates cancel. No callbacks at the consumer boundary: the consumer receives a message on the port and posts back a response message on the port. That is its entire external API.

**Turn runner.** Runs one turn. Asks the request builder for a body, calls the client to stream it, feeds the stream into the stream processor, handles tool uses via the registry and approval coordinator, pushes the assembled message and tool results into the conversation. Mostly internal glue. A test harness might drive it directly; a normal consumer goes through the query runner.

**Query runner.** Runs one query: one user ask, as many turns as the model needs. Handles the turn loop, consumes per-query input once (the first turn gets `systemReminder`, subsequent turns do not), retry counters for empty tool-use responses, cancel propagation, termination on stop reason or cancel. Provides a handle object: `port` (present if the default control blocks are in use), `events` (always present, read-only), `done` (promise), `cancel()` (shortcut for posting a cancel message on the port).

**Session.** Bundles client + conversation + durable config into "the thing I am talking to". Holds state for the life of the process. Provides: `query(input)` returning a query handle, `configure(partial)` to update durable config mid-session, direct access to `conversation`, `config`, and `client` for consumers that want to reach in. Not persistent. Not hydratable. The process dies, the session dies. If the consumer wants to save and resume, the consumer reads the conversation out itself.

## What is not in the SDK

- Session ids. The SDK has no concept of a session identifier. If the consumer wants to tag sessions, that is a consumer concern.
- Session files. No JSONL, no directories, no atomic writes, no load-on-construct.
- Audit files. No `RawEventWriter` inside the SDK. No `AuditWriter`. Audit is a consumer that subscribes to the query handle's event taps and writes wherever it wants.
- `historyFile` as a configuration field. Anywhere.
- `mkdirSync`, `appendFileSync`, `readFileSync`, `writeFileSync`, `renameSync`. These do not appear in any SDK source file. Ever.
- CLAUDE.md loading, config file loading, any other file-based input. Consumer concern.

If any of these slip back in during the rewrite, it is a sign a rule is being forgotten.

## Why this plan is written this way

Issue #232 and the earlier session log captured a six-step technical plan ("extract client, reshape API, remove `ConversationStore`, ...") without writing down the two underlying problems. A later session reading those documents saw only the steps and drifted back towards preserving technical shapes rather than solving the original problems. The why had to be reconstructed from memory by the person who still held it.

The rule that follows: every plan writes down the why first. The what is a consequence of the why and has to be re-derivable from it on every read, not blindly copied forward. If a later change to this file removes the why section, undo that change.

The `#232` framing also appears in code comments, for example the class JSDoc on `AnthropicClient.ts`. These references should be updated as the refactor touches each file, to point at this plan file instead.
