# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial release: MCP server wrapping claude-sdk-tools Exec

### Changed

- Update Exec tool wrapper for structured handler output
- Update build dependencies
- Updated patch dependencies

### Security

- Fixed GHSA-458j-xx4x-4375: hono HTML injection in JSX SSR ([GHSA-458j-xx4x-4375](https://github.com/advisories/GHSA-458j-xx4x-4375))
- Fix GHSA-v2v4-37r5-5v8g: XSS in ip-address HTML-emitting methods ([GHSA-v2v4-37r5-5v8g](https://github.com/advisories/GHSA-v2v4-37r5-5v8g))
- Fix GHSA-9vqf-7f2p-gf9v: Hono bodyLimit bypass for chunked requests ([GHSA-9vqf-7f2p-gf9v](https://github.com/advisories/GHSA-9vqf-7f2p-gf9v))
- Fix GHSA-69xw-7hcm-h432: hono/jsx HTML injection ([GHSA-69xw-7hcm-h432](https://github.com/advisories/GHSA-69xw-7hcm-h432))
