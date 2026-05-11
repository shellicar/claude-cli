# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Support binary file reads through encoding parameter on IFileSystem.readFile

### Changed

- Update runtime and build dependencies
- Updated patch dependencies

### Fixed

- Package now publishes CJS alongside ESM with working sourcemaps
- Re-establish ANSI colour state on wrapped continuation lines
