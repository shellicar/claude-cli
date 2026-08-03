# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add a BLUE foreground ANSI colour constant
- Add a chdir operation to the IFileSystem contract
- Add a README describing the package and pointing to the main documentation
- Add arch and createWriteStream operations to the IFileSystem contract
- Add IObjectStore interface for injectable persistence
- Add overrides option to ConfigLoader for a highest-precedence config layer
- Add rename and platform operations to the IFileSystem contract
- Add the conversation-history model: store types, read/write interfaces, and near-duplicate detection (shingle, minhash, LSH) for the sweep
- Add the Memory tool: a persistent, shared, relevance-searchable memory Claude reads and writes across sessions
- canonicalisePath resolves a path to where it actually lands, following symlinks even when the target does not exist yet, for callers that must decide on the destination rather than the string they were handed
- Condition attached images: resize to a 2000px PNG long edge via sips, downscaling only, and log each outcome to the debug log; a missing or failing sips passes the image through unchanged
- F3 is now recognised as a key action
- IFileSystem gains readFileBytes, for a reader that scans a file's bytes rather than decoding it to a string
- IFileSystem gains tmpdir, uid, mkdir with an explicit mode, lstat, and a synchronous readlinkSync, so code that needs a temporary directory, or has to create one and check who owns it, can reach all of it through the filesystem seam instead of node:os and node:fs directly
- Parse mouse-wheel events from stdin into scroll_up/scroll_down key actions; add enableMouse/disableMouse escape sequences
- StatResult now carries uid and mode, so a caller can tell who owns a path and who else can reach it
- Support binary file reads through encoding parameter on IFileSystem.readFile

### Changed

- Adopt core-di-lite property injection: config loading splits into a pure read, a holder, and a watch handle with no load or start step, and the shared provider and contract abstractions live here for every package to resolve against
- Depend on @shellicar/core-di instead of @shellicar/core-di-lite
- File discovery returns records carrying type, size, and symlink target instead of bare path strings
- IFileSystem gained openWriteStream, which opens the file before returning so an unwritable path fails at the caller rather than later on the stream; an existing implementation must add it
- setupKeypressHandler accepts an optional escFastPathEnabled callback, checked live before taking the lone-ESC fast path, so a consumer can disable it (e.g. over a fragmented remote connection) without a restart
- Update runtime and build dependencies
- Updated patch and minor dependencies
- Updated patch dependencies

### Fixed

- Config merge now recurses arbitrarily deep instead of stopping after one nested level, so a local override several levels down (e.g. one entry of a nested record) no longer silently replaces its whole containing object and drops its siblings
- Fix a perceived ~500ms lag on every Escape keypress: a raw stdin chunk containing only the ESC byte is now emitted immediately as an escape KeyAction instead of waiting on readline's internal CSI-sequence disambiguation timeout
- Fix absent-file and inode-swap defects in config file watching
- Fix version metadata
- Package now publishes CJS alongside ESM with working sourcemaps
- Re-establish ANSI colour state on wrapped continuation lines
