import { describe, expect, it } from 'vitest';
import { defaultPolicy } from '../../src/Policy/defaultPolicy.js';
import { resolve } from '../../src/Policy/resolve.js';
import type { ToolLookup } from '../../src/Policy/validatePolicy.js';
import { validatePolicy } from '../../src/Policy/validatePolicy.js';

const cwd = '/repo';
const home = '/home/stephen';

/** The default names no tool and no input field, so an empty lookup is the honest one. */
function lookup(): ToolLookup {
  return { get: () => undefined };
}

describe('defaultPolicy', () => {
  it('is itself a valid policy — the shipped default must pass its own validation', () => {
    const result = validatePolicy(defaultPolicy, lookup());
    expect(result.valid).toBe(true);
  });

  it('allows reading inside the working directory', () => {
    const actual = resolve(defaultPolicy, { tool: 'Read', input: {}, paths: [`${cwd}/src/a.ts`], operation: 'fs.read', cwd, home }).verdict;
    expect(actual).toBe('allow');
  });

  it('allows listing inside the working directory', () => {
    const actual = resolve(defaultPolicy, { tool: 'Find', input: {}, paths: [`${cwd}/src`], operation: 'fs.list', cwd, home }).verdict;
    expect(actual).toBe('allow');
  });

  // The old default allowed reads everywhere and relied on a `~/.ssh/**` carve-out sitting above
  // that rule. Scoping the allow to the working directory means anything outside it is asked
  // about on its own merits, with no ordering to get wrong.
  it('asks before reading outside the working directory', () => {
    const actual = resolve(defaultPolicy, { tool: 'Read', input: {}, paths: [`${home}/.ssh/id_ed25519`], operation: 'fs.read', cwd, home }).verdict;
    expect(actual).toBe('ask');
  });

  it('asks before writing, even inside the working directory', () => {
    const actual = resolve(defaultPolicy, { tool: 'EditFile', input: {}, paths: [`${cwd}/src/a.ts`], operation: 'fs.write', cwd, home }).verdict;
    expect(actual).toBe('ask');
  });

  it('asks before running a program', () => {
    const actual = resolve(defaultPolicy, { tool: 'Program', input: { program: 'rm', args: ['-rf', '/tmp'] }, paths: [cwd], operation: 'fs.exec', cwd, home }).verdict;
    expect(actual).toBe('ask');
  });

  it('never silently allows something with no matching rule', () => {
    const actual = resolve(defaultPolicy, { tool: 'SomeFutureTool', input: {}, paths: [], operation: 'escalate', cwd, home }).verdict;
    expect(actual).toBe('ask');
  });
});
