# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add a README covering what the MCP server does, how to install it, and how to wire it into an MCP client
- Allow home directory override when normalising paths, enabling unit testing without OS mocking
- Built-in validation rules blocking rm, sed -i, git reset, force push, xargs, and sudo
- Differentiated ENOENT exit codes: exit 126 for working directory not found, exit 127 for program not found
- Exec tool MCP server with sequential, bail-on-error, and independent chaining modes
- Export normaliseInput, normaliseCommand, and expandPath from package
- Initial release: MCP server wrapping claude-sdk-tools Exec
- merge_stderr support on single commands (equivalent to 2>&1)
- Path expansion (~ and $VAR) for program, cwd, and redirect.path fields
- Pluggable rule system for custom validation
- Support for stdin injection, environment variables, working directory, output redirection, ANSI stripping, timeout, and background execution

### Changed

- Bundle first-party @shellicar libraries into the output; third-party dependencies stay external
- Content and structuredContent derived from a single canonical result
- Example added to tool description
- ExecRule.check now receives Command[] instead of Step
- Replace discriminated union (type: command/pipeline) with unified commands array; remove type field
- Strict schema validation (.strict()) on all input objects for better small-model compatibility
- Update build dependencies
- Update Exec tool wrapper for structured handler output
- Updated patch and minor dependencies
- Updated patch dependencies
- Wrap the ExecV3 tool (structured commands array with per-command operators) instead of the v1 Exec tool

### Fixed

- Fix ANSI escape codes not stripped from structuredContent output
- Fix stale tool description shown to MCP clients with incorrect examples
- Fix tool handler structuredContent validation against ExecOutputSchema (MCP SDK error -32602)

### Security

- Fix GHSA-3v7f-55p6-f55p: picomatch method injection in POSIX character classes ([GHSA-3v7f-55p6-f55p](https://github.com/advisories/GHSA-3v7f-55p6-f55p))
- Fix GHSA-69xw-7hcm-h432: hono/jsx HTML injection ([GHSA-69xw-7hcm-h432](https://github.com/advisories/GHSA-69xw-7hcm-h432))
- Fix GHSA-9vqf-7f2p-gf9v: Hono bodyLimit bypass for chunked requests ([GHSA-9vqf-7f2p-gf9v](https://github.com/advisories/GHSA-9vqf-7f2p-gf9v))
- Fix GHSA-c2c7-rcm5-vvqj: picomatch ReDoS via extglob quantifiers ([GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj))
- Fix GHSA-v2v4-37r5-5v8g: XSS in ip-address HTML-emitting methods ([GHSA-v2v4-37r5-5v8g](https://github.com/advisories/GHSA-v2v4-37r5-5v8g))
- Fixed GHSA-458j-xx4x-4375: hono HTML injection in JSX SSR ([GHSA-458j-xx4x-4375](https://github.com/advisories/GHSA-458j-xx4x-4375))
