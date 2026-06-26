# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Merge a child's stderr into its stdout by routing both to the same stream
- Spawned children are detached from the operator's tty and the process group is killed on abort (SIGTERM, then SIGKILL after a grace period)
- Stream-based interface for spawning a single process, with stdin, stdout, and stderr wired as streams
