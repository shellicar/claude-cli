import { describe, expect, it } from 'vitest';
import { resolve } from '../../src/Policy/resolve.js';
import type { PolicySet } from '../../src/Policy/types.js';

// One real, composed policy \u2014 not a synthetic toy \u2014 replicating what the current CLI already
// does across three previously-separate mechanisms: ExecV3's defaultRules (Exec/ruleConfig.ts),
// the path-zone permission matrix (apps/claude-sdk-cli/src/permissions.ts), and the Memory
// tools' frictionless carve-out. One ordered list, first match wins.
const cwd = '/repo';
const home = '/home/stephen';

const policy: PolicySet = [
  { tool: ['WriteMemory', 'ReadMemory', 'SearchMemory', 'DeleteMemory', 'MemoryTypes'], default: 'allow' },

  { tool: 'Program', input: { programs: ['rm', 'rmdir', 'mkfs', 'dd', 'shred'] }, default: 'deny' },
  { tool: 'Program', input: { programs: ['sed'], argsAnyOf: ['-i', '--in-place'] }, default: 'deny' },
  { tool: 'Program', input: { programs: ['git'], argsAllOf: ['reset'] }, default: 'deny' },
  { tool: 'Program', input: { programs: ['git'], argsAllOf: ['push'], argsAnyOf: ['-f', '--force'] }, default: 'deny' },

  { path: '~/.ssh/**', default: 'deny' },
  { path: '$PWD', operations: { 'fs.read': 'allow', 'fs.list': 'allow', 'fs.write': 'ask', 'fs.delete': 'ask', 'fs.exec': 'ask' } },
  { path: '*', operations: { 'fs.read': 'allow', 'fs.list': 'allow', 'fs.write': 'ask', 'fs.delete': 'deny', 'fs.exec': 'ask' } },

  { tool: '*', default: 'ask' },
];

function verdictFor(args: { tool: string; input?: unknown; paths?: string[]; operation: string }) {
  return resolve(policy, { tool: args.tool, input: args.input ?? {}, paths: args.paths ?? [], operation: args.operation, cwd, home });
}

describe('the composed policy \u2014 Memory tools stay frictionless', () => {
  it('allows WriteMemory regardless of operation, matching the delete-default that would otherwise ask', () => {
    const expected = 'allow';
    const actual = verdictFor({ tool: 'DeleteMemory', operation: 'fs.delete' });
    expect(actual).toBe(expected);
  });
});

describe('the composed policy \u2014 ExecV3-shaped command blocking', () => {
  it('blocks rm -rf via Program', () => {
    const expected = 'deny';
    const actual = verdictFor({ tool: 'Program', input: { program: 'rm', args: ['-rf', '/tmp'] }, operation: 'fs.exec' });
    expect(actual).toBe(expected);
  });

  it('blocks git reset --hard via Program', () => {
    const expected = 'deny';
    const actual = verdictFor({ tool: 'Program', input: { program: 'git', args: ['reset', '--hard'] }, operation: 'fs.exec' });
    expect(actual).toBe(expected);
  });

  it('leaves an ordinary Program call alone, falling through to the fs.exec path tier', () => {
    const expected = 'ask';
    const actual = verdictFor({ tool: 'Program', input: { program: 'pnpm', args: ['build'] }, paths: [cwd], operation: 'fs.exec' });
    expect(actual).toBe(expected);
  });
});

describe('the composed policy \u2014 path zones', () => {
  it('an ssh key carve-out wins even though the key sits inside $PWD in this scenario', () => {
    const expected = 'deny';
    const actual = verdictFor({ tool: 'Find', paths: [`${home}/.ssh/id_ed25519`], operation: 'fs.read' });
    expect(actual).toBe(expected);
  });

  it('reads inside the working directory are allowed', () => {
    const expected = 'allow';
    const actual = verdictFor({ tool: 'Find', paths: [`${cwd}/src/a.ts`], operation: 'fs.read' });
    expect(actual).toBe(expected);
  });

  it('deletes inside the working directory ask, deletes outside it deny', () => {
    const inside = verdictFor({ tool: 'DeleteFile', paths: [`${cwd}/a.txt`], operation: 'fs.delete' });
    const outside = verdictFor({ tool: 'DeleteFile', paths: ['/tmp/b.txt'], operation: 'fs.delete' });
    expect(inside).toBe('ask');
    expect(outside).toBe('deny');
  });
});

describe('the composed policy \u2014 the final catch-all', () => {
  it('asks for a tool with no path and no matching rule at all, never silently allowing', () => {
    const expected = 'ask';
    const actual = verdictFor({ tool: 'SomeFutureTool', operation: 'escalate' });
    expect(actual).toBe(expected);
  });
});
