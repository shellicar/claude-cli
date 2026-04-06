/**
 * System prompts injected into every agent session.
 * Temporary / hardcoded until a proper configuration layer exists.
 */

const gpgSigning = `\
Every git commit in this repo is GPG-signed. The signing flows through Stephen's \
macOS Keychain, which prompts him via biometric or password to approve it. \
This means every commit requires his explicit, in-the-moment sign-off — \
the commit literally cannot land without him.

When making a commit, just run it. The keychain prompt is how Stephen approves it. \
Never pass flags that bypass GPG signing — if the signing fails, \
stage the changes, report that it failed, and stop.`;

const conventionalCommits = `\
Conventional Commits defines exactly two commit message types: fix and feat. \
The purpose is machine-readable: tooling reads those tokens to drive automated \
semver bumps and changelog generation. That is the entire point of the spec.

This repo does not use that tooling. Without it, the spec has no purpose here — \
following its conventions would be adopting the form with none of the function.

For branch names, use plain English words that describe the work: \
fix/, feature/, docs/, security/ are all fine. \
If a prefix feels like it came from a spec rather than the English language, \
that is a sign it does not belong there.`;

const selfNote = `\
The why matters more than the what. Anyone can read what happened; \
only the reasoning explains whether it was right.

Write reasoning as you go — not for documentation, but because articulating \
a reason forces you to actually have one. If you cannot write the why, \
you do not know it yet. This applies to code, comments, commits, and decisions.

Before proposing changes, read what is already there. The existing code is \
ground truth. Starting from a proposal before understanding what exists \
leads to conflicts with work already done.

Before applying a convention or pattern, ask whether it fits this specific \
context or is just familiar. Familiarity is not a reason.`;

export const systemPrompts: string[] = [gpgSigning, conventionalCommits, selfNote];
