# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Export IFileSystem, NodeFileSystem, MemoryFileSystem, nodeFs singleton via ./fs entry

### Fixed

- Package now publishes CJS alongside ESM with working sourcemaps

## [1.0.0-alpha.1] - 2026-04-07

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

[1.0.0-alpha.1]: https://github.com/shellicar/claude-cli/releases/tag/claude-sdk-tools@1.0.0-alpha.1
