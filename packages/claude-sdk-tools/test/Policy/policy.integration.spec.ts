import { describe, expect, it } from 'vitest';
import { resolve } from '../../src/Policy/resolve.js';
import { resolveSet } from '../../src/Policy/resolveSet.js';
import type { PolicySet } from '../../src/Policy/types.js';

// One real, composed policy — not a synthetic toy — replicating what the current CLI already
// does across three previously-separate mechanisms: ExecV3's defaultRules (Exec/ruleConfig.ts),
// the path-zone permission matrix (apps/claude-sdk-cli/src/permissions.ts), and the Memory
// tools' frictionless carve-out. One ordered list, first match wins. Every `input` matcher
// names Program's real field names verbatim (`program`, `args`) — no translated vocabulary.
const cwd = '/repo';
const home = '/home/stephen';

const policy: PolicySet = [
  { tool: ['WriteMemory', 'ReadMemory', 'SearchMemory', 'DeleteMemory', 'MemoryTypes'], default: 'allow' },

  // program matching uses `basename` throughout — a rule naming 'rm' must also catch '/bin/rm'
  // or '/usr/local/bin/rm', the same guarantee `ruleConfigMatches`'s own basename() gives today.
  { tool: 'Program', input: { program: { basename: ['rm', 'rmdir', 'mkfs', 'dd', 'shred'] } }, default: 'deny', message: '{program} is destructive and irreversible. Ask the user to run it directly.' },
  { tool: 'Program', input: { program: { basename: ['sed'] }, args: { anyOf: ['-i', '--in-place'] } }, default: 'deny', message: '{program} -i modifies files in-place with no undo. Use the redirect option to write to a new file, or use the Edit tool.' },
  { tool: 'Program', input: { program: { basename: ['git'] }, args: { allOf: ['reset'] } }, default: 'deny', message: 'git reset is destructive and irreversible. Ask the user to run it directly.' },
  { tool: 'Program', input: { program: { basename: ['git'] }, args: { allOf: ['push'] } }, default: 'ask' },
  { tool: 'Program', input: { program: { suffix: '.exe' } }, default: 'deny', message: "there is no reason to call '{program}'. Run equivalent commands natively." },

  { path: '~/.ssh/**', default: 'deny' },
  { path: '$PWD', operations: { 'fs.read': 'allow', 'fs.list': 'allow', 'fs.write': 'ask', 'fs.delete': 'ask', 'fs.exec': 'ask' } },
  { path: '*', operations: { 'fs.read': 'allow', 'fs.list': 'allow', 'fs.write': 'ask', 'fs.delete': 'deny', 'fs.exec': 'ask' } },

  { tool: '*', default: 'ask' },
];

function resolveFor(args: { tool: string; input?: unknown; paths?: string[]; operation: string }) {
  return resolve(policy, { tool: args.tool, input: args.input ?? {}, paths: args.paths ?? [], operation: args.operation, cwd, home });
}

function verdictFor(args: { tool: string; input?: unknown; paths?: string[]; operation: string }) {
  return resolveFor(args).verdict;
}

describe('the composed policy — Memory tools stay frictionless', () => {
  it('allows WriteMemory regardless of operation, matching the delete-default that would otherwise ask', () => {
    const expected = 'allow';
    const actual = verdictFor({ tool: 'DeleteMemory', operation: 'fs.delete' });
    expect(actual).toBe(expected);
  });
});

describe('the composed policy — ExecV3-shaped command blocking, matched against real input fields', () => {
  it('blocks rm -rf via Program.input.program', () => {
    const expected = 'deny';
    const actual = verdictFor({ tool: 'Program', input: { program: 'rm', args: ['-rf', '/tmp'] }, operation: 'fs.exec' });
    expect(actual).toBe(expected);
  });

  it('tells the model why, interpolated from the real input', () => {
    const expected = 'rm is destructive and irreversible. Ask the user to run it directly.';
    const actual = resolveFor({ tool: 'Program', input: { program: 'rm', args: ['-rf', '/tmp'] }, operation: 'fs.exec' }).message;
    expect(actual).toBe(expected);
  });

  it('blocks git reset --hard via Program.input.args', () => {
    const expected = 'deny';
    const actual = verdictFor({ tool: 'Program', input: { program: 'git', args: ['reset', '--hard'] }, operation: 'fs.exec' });
    expect(actual).toBe(expected);
  });

  it('leaves an ordinary Program call alone, falling through to the fs.exec path tier', () => {
    const expected = 'ask';
    const actual = verdictFor({ tool: 'Program', input: { program: 'pnpm', args: ['build'] }, paths: [cwd], operation: 'fs.exec' });
    expect(actual).toBe(expected);
  });

  it('blocks any .exe by suffix, regardless of what it is actually called', () => {
    const expected = 'deny';
    const actual = verdictFor({ tool: 'Program', input: { program: 'malware.exe', args: [] }, operation: 'fs.exec' });
    expect(actual).toBe(expected);
  });

  it('blocks rm called by its full path, not just the bare name', () => {
    const expected = 'deny';
    const actual = verdictFor({ tool: 'Program', input: { program: '/bin/rm', args: ['-rf', '/tmp'] }, operation: 'fs.exec' });
    expect(actual).toBe(expected);
  });
});

describe('the composed policy — path zones', () => {
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

describe('the composed policy — the final catch-all', () => {
  it('asks for a tool with no path and no matching rule at all, never silently allowing', () => {
    const expected = 'ask';
    const actual = verdictFor({ tool: 'SomeFutureTool', operation: 'escalate' });
    expect(actual).toBe(expected);
  });
});

describe('the composed policy — command rules and path zones compose for one call', () => {
  it('a safe program with a dangerous cwd still falls through to the ssh carve-out, since no command rule catches it', () => {
    const expected = 'deny';
    const actual = verdictFor({ tool: 'Program', input: { program: 'cat', args: ['notes.txt'] }, paths: [`${home}/.ssh/id_ed25519`], operation: 'fs.exec' });
    expect(actual).toBe(expected);
  });
});

describe('the composed policy — resolveSet against the real policy, not a synthetic one', () => {
  it('folds a multi-target Find to the strictest verdict when one result is safe and one is not', () => {
    const targets = [`${cwd}/a.txt`, `${home}/.ssh/id_ed25519`];
    const resolutions = targets.map((p) => resolveFor({ tool: 'Find', paths: [p], operation: 'fs.read' }));
    const expected = 'deny';
    const actual = resolveSet(resolutions).verdict;
    expect(actual).toBe(expected);
  });
});

describe('the composed policy — a rule silent on an operation falls through to a later rule that covers it', () => {
  it('a $PWD-shaped rule with no fs.delete key at all does not resolve fs.delete itself — it falls through', () => {
    const withGap: PolicySet = [
      { path: '$PWD', operations: { 'fs.read': 'allow', 'fs.write': 'allow', 'fs.list': 'allow' } },
      { path: '*', operations: { 'fs.delete': 'deny' } },
      { tool: '*', default: 'ask' },
    ];

    const expected = 'deny';
    const actual = resolve(withGap, { tool: 'Delete', input: {}, paths: [`${cwd}/a.txt`], operation: 'fs.delete', cwd, home }).verdict;
    expect(actual).toBe(expected);
  });
});

describe('the composed policy — rule order is load-bearing, not incidental', () => {
  it('would silently allow reading an ssh key if the carve-out were moved below the general path rule', () => {
    const reordered: PolicySet = [
      { path: '$PWD', operations: { 'fs.read': 'allow' } },
      { path: '*', operations: { 'fs.read': 'allow' } },
      { path: '~/.ssh/**', default: 'deny' },
      { tool: '*', default: 'ask' },
    ];

    const correctOrder = verdictFor({ tool: 'Find', paths: [`${home}/.ssh/id_ed25519`], operation: 'fs.read' });
    const wrongOrder = resolve(reordered, { tool: 'Find', input: {}, paths: [`${home}/.ssh/id_ed25519`], operation: 'fs.read', cwd, home }).verdict;

    expect(correctOrder).toBe('deny');
    expect(wrongOrder).toBe('allow');
  });
});
