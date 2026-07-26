import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defaultPolicy } from '../../src/Policy/defaultPolicy.js';
import { resolve } from '../../src/Policy/resolve.js';
import { validatePolicy } from '../../src/Policy/validatePolicy.js';
import type { ToolLookup } from '../../src/Policy/validatePolicy.js';

const cwd = '/repo';
const home = '/home/stephen';

// A minimal lookup naming the fields the default policy actually references — not the real
// ToolsV2Registry, since this test is about the shipped constant's own shape and behaviour,
// not registry wiring (already covered elsewhere).
function lookup(): ToolLookup {
  const programModel = z.object({ program: z.string(), args: z.array(z.string()).optional() });
  return { get: (name) => (name === 'Program' ? { model: programModel } : undefined) };
}

describe('defaultPolicy', () => {
  it('is itself a valid policy — the shipped default must pass its own validation', () => {
    const result = validatePolicy(defaultPolicy, lookup());
    expect(result.valid).toBe(true);
  });

  it('blocks rm -rf, matching ExecV3’s real behaviour', () => {
    const actual = resolve(defaultPolicy, { tool: 'Program', input: { program: 'rm', args: ['-rf', '/tmp'] }, paths: [], operation: 'fs.exec', cwd, home }).verdict;
    expect(actual).toBe('deny');
  });

  it('keeps Memory tools frictionless', () => {
    const actual = resolve(defaultPolicy, { tool: 'DeleteMemory', input: {}, paths: [], operation: 'fs.delete', cwd, home }).verdict;
    expect(actual).toBe('allow');
  });

  it('protects an ssh key even inside the working directory', () => {
    const actual = resolve(defaultPolicy, { tool: 'Find', input: {}, paths: [`${home}/.ssh/id_ed25519`], operation: 'fs.read', cwd, home }).verdict;
    expect(actual).toBe('deny');
  });

  it('never silently allows something with no matching rule', () => {
    const actual = resolve(defaultPolicy, { tool: 'SomeFutureTool', input: {}, paths: [], operation: 'escalate', cwd, home }).verdict;
    expect(actual).toBe('ask');
  });
});
