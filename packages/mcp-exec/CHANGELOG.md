# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Exec tool MCP server with sequential, bail-on-error, and independent chaining modes
- Support for stdin injection, environment variables, working directory, output redirection, ANSI stripping, timeout, and background execution
- Built-in validation rules blocking rm, sed -i, git reset, force push, xargs, and sudo
- Pluggable rule system for custom validation
- Path expansion (~ and $VAR) for program, cwd, and redirect.path fields
- merge_stderr support on single commands (equivalent to 2>&1)
- Differentiated ENOENT exit codes: exit 126 for working directory not found, exit 127 for program not found
- Export normaliseInput, normaliseCommand, and expandPath from package
- Allow home directory override when normalising paths, enabling unit testing without OS mocking
- Initial release: MCP server wrapping claude-sdk-tools Exec

### Changed

- Replace discriminated union (type: command/pipeline) with unified commands array; remove type field
- ExecRule.check now receives Command[] instead of Step
- Strict schema validation (.strict()) on all input objects for better small-model compatibility
- Example added to tool description
- Content and structuredContent derived from a single canonical result
- Update Exec tool wrapper for structured handler output
- Update build dependencies
- Updated patch dependencies

### Fixed

- Fix tool handler structuredContent validation against ExecOutputSchema (MCP SDK error -32602)
- Fix stale tool description shown to MCP clients with incorrect examples
- Fix ANSI escape codes not stripped from structuredContent output

### Security

- Fix GHSA-c2c7-rcm5-vvqj: picomatch ReDoS via extglob quantifiers ([GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj))
- Fix GHSA-3v7f-55p6-f55p: picomatch method injection in POSIX character classes ([GHSA-3v7f-55p6-f55p](https://github.com/advisories/GHSA-3v7f-55p6-f55p))
- Fixed GHSA-458j-xx4x-4375: hono HTML injection in JSX SSR ([GHSA-458j-xx4x-4375](https://github.com/advisories/GHSA-458j-xx4x-4375))
- Fix GHSA-v2v4-37r5-5v8g: XSS in ip-address HTML-emitting methods ([GHSA-v2v4-37r5-5v8g](https://github.com/advisories/GHSA-v2v4-37r5-5v8g))
- Fix GHSA-9vqf-7f2p-gf9v: Hono bodyLimit bypass for chunked requests ([GHSA-9vqf-7f2p-gf9v](https://github.com/advisories/GHSA-9vqf-7f2p-gf9v))
- Fix GHSA-69xw-7hcm-h432: hono/jsx HTML injection ([GHSA-69xw-7hcm-h432](https://github.com/advisories/GHSA-69xw-7hcm-h432))
