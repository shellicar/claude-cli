# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add a chdir operation to the IFileSystem contract
- Add a README describing the package and pointing to the main documentation
- Add IObjectStore interface for injectable persistence
- Add overrides option to ConfigLoader for a highest-precedence config layer
- Add rename and platform operations to the IFileSystem contract
- Add the Memory tool: a persistent, shared, relevance-searchable memory Claude reads and writes across sessions
- Condition attached images: resize to a 2000px PNG long edge via sips, downscaling only, and log each outcome to the debug log; a missing or failing sips passes the image through unchanged
- Parse mouse-wheel events from stdin into scroll_up/scroll_down key actions; add enableMouse/disableMouse escape sequences
- Support binary file reads through encoding parameter on IFileSystem.readFile

### Changed

- Adopt core-di-lite property injection: config loading splits into a pure read, a holder, and a watch handle with no load or start step, and the shared provider and contract abstractions live here for every package to resolve against
- File discovery returns records carrying type, size, and symlink target instead of bare path strings
- Update runtime and build dependencies
- Updated patch and minor dependencies
- Updated patch dependencies

### Fixed

- Fix absent-file and inode-swap defects in config file watching
- Package now publishes CJS alongside ESM with working sourcemaps
- Re-establish ANSI colour state on wrapped continuation lines
