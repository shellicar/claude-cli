# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add a README describing the package and pointing to the main documentation
- Added drainToString, which collects a stream to a string while keeping at most a given number of bytes and reporting how many there were
- Allow killing a process with a chosen signal
- Merge a child's stderr into its stdout by routing both to the same stream
- Run a pipeline as one unit, joining stages at the file descriptor so the kernel provides backpressure and stops a producer whose consumer has exited
- Spawned children are detached from the operator's tty and the process group is killed on abort (SIGTERM, then SIGKILL after a grace period)
- Stream-based interface for spawning a single process, with stdin, stdout, and stderr wired as streams

### Changed

- IExecutor now requires a runPipeline method, so an existing implementation of the interface must add one

### Removed

- Removed the PipeConsumerGone abort reason, which existed only to simulate a broken pipe in userland

### Fixed

- A cancelled multi-stage pipeline now returns instead of hanging after its processes are killed
- A command no longer hangs when an output sink it was given is drained slowly or not at all
- A pipeline that cannot start one of its stages no longer leaves the stages already started running unwatched
- A working directory that exists but is not a directory now reports 126 like a missing one, instead of failing the whole call with a raw spawn error
- Fix version metadata
