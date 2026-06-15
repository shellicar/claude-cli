# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- File read tools: Find, ReadFile, Grep, Head, Tail, Range, SearchFiles
- File write tools: CreateFile, DeleteFile, DeleteDirectory
- PreviewEdit and EditFile tools for staged edits with diff preview
- Exec tool with structured args, multi-step pipelines, and permission model
- Pipe tool for chaining tool outputs
- IFileSystem abstraction with NodeFileSystem and MemoryFileSystem for testing
- Ref system for paginating large tool results that exceed context threshold
- Path expansion supporting ~, $HOME, and relative paths in all tools
- Split PreviewEdit edits into lineEdits (structural, bottom-to-top) and textEdits (text-search, applied after lineEdits)
- Export IFileSystem, NodeFileSystem, MemoryFileSystem, nodeFs singleton via ./fs entry
- Add appendFile to IFileSystem, NodeFileSystem, and MemoryFileSystem
- Add TypeScript language tools: ts_diagnostics, ts_hover, ts_references, ts_definition
- Add append operation to EditFile
- ReadFile supports PDF and image files with MIME type detection and magic bytes validation
- Add ExecV2 tool: execute commands as a recursive AST (commands joined by ;, &&, ||, &, | operators) instead of a steps array
- Exec subprocess is cancelled on ESC; elapsed time appears in the cancellation tool result

### Changed

- ReadFile accepts image/* to read any supported image format; the format is detected from file content rather than the declared type
- Removed the 500KB limit on text file reads
- Tool handlers return structured output with textContent and optional attachments
- Update runtime and build dependencies
- Updated patch dependencies
- Updated patch and minor dependencies

### Fixed

- Package now publishes CJS alongside ESM with working sourcemaps
- Normalise tilde and environment variable paths in EditFile
- Find tool follows symlinks with cycle detection
- Binary files are blocked from text reads when the format is recognised; unrecognised formats are still treated as text
- ReadFile rejects images whose base64 payload exceeds the Anthropic API 5 MB per-image cap

### Security

- Fix GHSA-p7fg-763f-g4gf: insecure file permissions in @anthropic-ai/sdk memory tool ([GHSA-p7fg-763f-g4gf](https://github.com/advisories/GHSA-p7fg-763f-g4gf))
