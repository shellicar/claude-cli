# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add IObjectStore interface for injectable persistence
- Add overrides option to ConfigLoader for a highest-precedence config layer
- Support binary file reads through encoding parameter on IFileSystem.readFile

### Changed

- Update runtime and build dependencies
- Updated patch and minor dependencies
- Updated patch dependencies

### Fixed

- Fix absent-file and inode-swap defects in config file watching
- Package now publishes CJS alongside ESM with working sourcemaps
- Re-establish ANSI colour state on wrapped continuation lines
