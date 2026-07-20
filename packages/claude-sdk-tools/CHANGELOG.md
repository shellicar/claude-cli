# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add a load-only Skill tool that resolves a skill by name from the configured roots and returns its body with frontmatter stripped; discovery stays in the injected catalogue, not the tool
- Add a permissions regression test asserting an escalate operation always resolves to Ask, even when every other operation is configured to auto-approve
- Add a README describing the package and pointing to the main documentation
- Add append operation to EditFile
- Add appendFile to IFileSystem, NodeFileSystem, and MemoryFileSystem
- Add AppendFile tool: appends text to a file, creating it if missing
- Add atomic rename and platform lookup to the Node filesystem implementation
- Add buildSkillCatalogue, which lists the resolvable skills (name, plus frontmatter description when present) for injection as an always-on catalogue
- Add chdir to the Node filesystem implementation, moving the process working directory
- Add ExecV2 tool: execute commands as a recursive AST (commands joined by ;, &&, ||, &, | operators) instead of a steps array
- Add ExecV3 structured execution tool
- Add IEnvProvider: the contract ExecV3 uses to build a child process's environment, letting a consumer strip ambient credentials and inject its own before every command runs
- Add scanSkillEntries, which scans the skill roots into a name-to-{line,hash} map so a caller can detect when a skill's SKILL.md content changes, including a body-only edit the catalogue line does not show
- Add six named GitHub.PullRequest tools (Create, Ready, Edit, Comment, AutoMerge, Review) that run gh through an isolated holder credential, each structurally restricted to its own gh subcommand and flag set
- Add the Memory tool: a persistent, shared, relevance-searchable memory Claude reads and writes across sessions
- Add the SearchHistory and ReadHistory tools: locate recorded turns by full-text search, then read the cited turns with their surrounding window
- Add TypeScript language tools: ts_diagnostics, ts_hover, ts_references, ts_definition
- Added AzCli and EscalatedAzCli, free-text `az` command tools running as a certificate-authenticated reader or holder identity respectively; EscalatedAzCli always requires approval
- Added AzCli and EscalatedAzCli, free-text `az` command tools running under a reader or holder AZURE_CONFIG_DIR profile respectively; EscalatedAzCli always requires approval
- Added AzureDevOps_PullRequest_* tools (Create, Ready, Edit, AutoMerge, ReviewerAdd, ReviewerRemove, Vote), each running one fixed `az repos pr` subcommand as a certificate-authenticated holder identity, always requiring approval
- Added named AzureDevOps_PullRequest_* tools (Create, Ready, Edit, AutoMerge, ReviewerAdd, ReviewerRemove, Vote), each running one fixed `az repos pr` subcommand under a holder PAT, always requiring approval
- AzureDevOps_PullRequest_* and Az tools resolve org/project/repository from the target repo's own git remote when not given explicitly, and accept an optional cwd so they can target a repo other than the CLI's own working directory
- AzureDevOps_PullRequest_Create always opens as a draft; AzureDevOps_PullRequest_AutoMerge generates its merge commit message from the pull request's own title and description rather than accepting one from the caller
- Exec subprocess is cancelled on ESC; elapsed time appears in the cancellation tool result
- Exec tool with structured args, multi-step pipelines, and permission model
- ExecV3 accepts a configurable blocklist of command patterns (program plus an ordered subsequence of args) that it refuses to start
- ExecV3 command results now include durationMs, the wall-clock time from spawn to settle for that stage; the response also carries a top-level durationMs for the whole run
- Export IFileSystem, NodeFileSystem, MemoryFileSystem, nodeFs singleton via ./fs entry
- File read tools: Find, ReadFile, Grep, Head, Tail, Range, SearchFiles
- File write tools: CreateFile, DeleteFile, DeleteDirectory
- GitHub_PullRequest_* tools accept an optional cwd so they can target a repo other than the CLI's own working directory
- GitHub_PullRequest_Create accepts milestone, reviewer, assignee, and label; GitHub_PullRequest_Edit accepts addAssignee/removeAssignee, addReviewer/removeReviewer, milestone, and removeMilestone
- IFileSystem abstraction with NodeFileSystem and MemoryFileSystem for testing
- Path expansion supporting ~, $HOME, and relative paths in all tools
- Pipe tool for chaining tool outputs
- PreviewEdit and EditFile tools for staged edits with diff preview
- ReadFile supports PDF and image files with MIME type detection and magic bytes validation
- Ref and PreviewEdit state is now persisted to disk
- Ref system for paginating large tool results that exceed context threshold
- Split PreviewEdit edits into lineEdits (structural, bottom-to-top) and textEdits (text-search, applied after lineEdits)

### Changed

- Adopt core-di-lite property injection: TsServerService resolves its options through injection and disposes its tsserver process on scope exit
- Composable pipe tools redesigned into atomic, single-role tools over typed streams; each takes its own input instead of the pipe's internal transport shape
- Consolidate process spawn behind a shared exec-core interface and detach spawned commands from the controlling terminal
- EditFile returns a plain-text, line-numbered diff instead of a JSON object, so the result is readable without unescaping
- EditFile's insert after_line accepts negative indices (-1 = after the last line) so appending no longer requires knowing the file's line count
- Exec, ExecV2, and ExecV3 redirect writes now go through IFileSystem instead of importing node:fs directly
- ExecV3 requires an IEnvProvider argument; createExecV3 and configureExecV3 signatures changed to accept it
- Mark every filesystem-path field on the tool schemas so the SDK normalises it, and drop the per-handler path expansion; DeleteFile and DeleteDirectory now take a files array
- Merge PreviewEdit and EditFile into a single EditFile tool that validates, writes, and returns a diff in one call, removing the preview/confirm step and its in-memory patch store
- ReadFile accepts image/* to read any supported image format; the format is detected from file content rather than the declared type
- ReadFile returns a successful text read as plain path-and-line text instead of a JSON object, matching the Pipe Read stage's output
- Regex pattern fields now reject a malformed pattern as a schema validation error, naming the cause, before any tool runs
- Removed the 500KB limit on text file reads
- replace_text edits are applied as a literal string replace instead of being escaped into a regex
- Resize and normalise an image ReadFile result before it is attached, leaving non-image documents untouched
- runGhEscalated also strips SSH_AUTH_SOCK, matching the reader path's strip list
- textEdits error messages include the failing edit's index (e.g. textEdits[1]) so a caller can tell which edit failed when several are chained in one call
- Tool handlers return structured output with textContent and optional attachments
- TsReferences and TsDefinition group their results by file path, and TsDiagnostics accepts a batch of files in one call
- Update runtime and build dependencies
- Updated patch and minor dependencies
- Updated patch dependencies

### Removed

- Remove EditFile's append field now that negative after_line covers the same case and composes with other edits in the same call

### Fixed

- A failed tsserver request now throws instead of returning an empty result that was indistinguishable from a clean file
- Binary files are blocked from text reads when the format is recognised; unrecognised formats are still treated as text
- ExecV3 and Memory import defineTool, ToolCancelledError, ToolRefusedError, and pathSchema from their own claude-sdk subpaths instead of the barrel, so a consumer bundling this package no longer pulls in the whole SDK module graph
- Find tool follows symlinks with cycle detection
- GitHub_PullRequest_AutoMerge takes a required strategy (merge, squash, rebase) when enabling, so it can queue a specific merge method instead of only accepting the repo default
- Normalise tilde and environment variable paths in EditFile
- Package now publishes CJS alongside ESM with working sourcemaps
- Raise the default tsserver per-request timeout from 3s to 30s so a cold spawn's first request (loading the whole program/type graph) doesn't get abandoned as a timeout
- ReadFile rejects images whose base64 payload exceeds the Anthropic API 5 MB per-image cap
- Tear down a pipe stage's upstream when its consumer exits, so pipelines like find | head no longer hang
- The TypeScript tools now read each file fresh from disk, spawning a short-lived tsserver per tool block instead of a session-long server that kept reporting its first snapshot

### Security

- Fix buildEnvFrom letting a model-supplied cmdEnv value override the identity a provider forces (e.g. GH_TOKEN), which let ExecV3 override its own read-only credential; provider identity now always wins
- Fix GHSA-p7fg-763f-g4gf: insecure file permissions in @anthropic-ai/sdk memory tool ([GHSA-p7fg-763f-g4gf](https://github.com/advisories/GHSA-p7fg-763f-g4gf))
