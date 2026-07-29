import type { PolicySet } from './types.js';

/**
 * The shipped default: reads and listings inside the working directory, and nothing else.
 *
 * Everything not named here falls to the engine's own `ask` — never a silent allow — so the
 * default decides as little as possible while still being usable. Without this one rule every
 * file read would prompt, which in practice drives an operator to paste in a blanket allow;
 * with it, working inside the project is quiet and anything reaching beyond it is seen.
 *
 * Deliberately free of opinions. An earlier version shipped a list of denied commands
 * (`rm`, `git reset`, `sudo`, inline `-c`), a frictionless carve-out for the Memory tools, and a
 * `~/.ssh/**` deny. Those existed because there was no way to express them in config; now there
 * is, so they belong to whoever is running the thing, not to the product. Two reasons that
 * matters beyond taste:
 *
 * - A shipped deny list is a guess about someone else's work. Editing your own ssh config or an
 *   env file with help is a legitimate task, and a default that forbids it is wrong for that
 *   operator while looking authoritative.
 * - A carve-out in front of a permissive rule only protects while the ordering holds. The old
 *   default allowed reads everywhere (`path: '*'`) and relied on the ssh deny sitting above it.
 *   Scoping the allow to the working directory means anything outside it is asked about on its
 *   own merits, rather than depending on someone having predicted which paths were sensitive.
 */
export const defaultPolicy: PolicySet = [{ path: '$PWD', operations: { 'fs.read': 'allow', 'fs.list': 'allow' } }];
