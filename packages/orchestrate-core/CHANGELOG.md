# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- New package: a runtime for composing tools into a pipeline — plan and execute a list of stages joined by |, && and ||, stream one stage's output into the next, fan a batch out with Xargs, and capture a stage's output as a named variable later stages reference
