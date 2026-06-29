# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add a README describing the package and pointing to the main documentation
- Add append operation to EditFile
- Add appendFile to IFileSystem, NodeFileSystem, and MemoryFileSystem
- Add AppendFile tool: appends text to a file, creating it if missing
- Add ExecV2 tool: execute commands as a recursive AST (commands joined by ;, &&, ||, &, | operators) instead of a steps array
- Add TypeScript language tools: ts_diagnostics, ts_hover, ts_references, ts_definition
- Exec subprocess is cancelled on ESC; elapsed time appears in the cancellation tool result
- Exec tool with structured args, multi-step pipelines, and permission model
- Export IFileSystem, NodeFileSystem, MemoryFileSystem, nodeFs singleton via ./fs entry
- File read tools: Find, ReadFile, Grep, Head, Tail, Range, SearchFiles
- File write tools: CreateFile, DeleteFile, DeleteDirectory
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
- Consolidate process spawn behind a shared exec-core interface and detach spawned commands from the controlling terminal
- ReadFile accepts image/* to read any supported image format; the format is detected from file content rather than the declared type
- Removed the 500KB limit on text file reads
- Tool handlers return structured output with textContent and optional attachments
- Update runtime and build dependencies
- Updated patch and minor dependencies
- Updated patch dependencies

### Fixed

- Binary files are blocked from text reads when the format is recognised; unrecognised formats are still treated as text
- Find tool follows symlinks with cycle detection
- Normalise tilde and environment variable paths in EditFile
- Package now publishes CJS alongside ESM with working sourcemaps
- ReadFile rejects images whose base64 payload exceeds the Anthropic API 5 MB per-image cap

### Security

- Fix GHSA-p7fg-763f-g4gf: insecure file permissions in @anthropic-ai/sdk memory tool ([GHSA-p7fg-763f-g4gf](https://github.com/advisories/GHSA-p7fg-763f-g4gf))
