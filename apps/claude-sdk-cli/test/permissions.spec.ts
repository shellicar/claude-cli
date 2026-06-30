import type { AnyToolDefinition } from '@shellicar/claude-sdk';
import { describe, expect, it } from 'vitest';
import type { PermissionConfig } from '../src/permissions.js';
import { findUnknownTools, getPermission, PermissionAction } from '../src/permissions.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

const CWD = '/project';

// Minimal fs — homedir is /home/user, well outside CWD /project.
const fs = new MemoryFileSystem({}, '/home/user', CWD);

// Build the test matrix inline — this decouples the assertions from whatever
// the config schema happens to produce as its defaults.
const matrix: PermissionConfig = {
  default: {
    read: PermissionAction.Approve,
    write: PermissionAction.Approve,
    delete: PermissionAction.Ask,
  },
  outside: {
    read: PermissionAction.Approve,
    write: PermissionAction.Ask,
    delete: PermissionAction.Deny,
  },
};

// Minimal stubs — getPermission only needs name and operation from the definition.
function toolDef(name: string, operation: 'read' | 'write' | 'delete'): AnyToolDefinition {
  return { name, operation } as AnyToolDefinition;
}

const allTools: AnyToolDefinition[] = [toolDef('ReadFile', 'read'), toolDef('EditFile', 'write'), toolDef('DeleteFile', 'delete')];

// ---------------------------------------------------------------------------
// inside cwd
// ---------------------------------------------------------------------------

describe('getPermission — inside cwd', () => {
  it('read → Approve', () => {
    const expected = PermissionAction.Approve;
    const actual = getPermission({ name: 'ReadFile', input: { path: `${CWD}/src/file.ts` } }, allTools, CWD, matrix, fs);
    expect(actual).toBe(expected);
  });

  it('write → Approve', () => {
    const expected = PermissionAction.Approve;
    const actual = getPermission({ name: 'EditFile', input: { file: `${CWD}/src/file.ts` } }, allTools, CWD, matrix, fs);
    expect(actual).toBe(expected);
  });

  it('delete → Ask', () => {
    const expected = PermissionAction.Ask;
    const actual = getPermission({ name: 'DeleteFile', input: { path: `${CWD}/src/file.ts` } }, allTools, CWD, matrix, fs);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// outside cwd
// ---------------------------------------------------------------------------

describe('getPermission — outside cwd', () => {
  it('read → Approve', () => {
    const expected = PermissionAction.Approve;
    const actual = getPermission({ name: 'ReadFile', input: { path: '/tmp/file.ts' } }, allTools, CWD, matrix, fs);
    expect(actual).toBe(expected);
  });

  it('write → Ask', () => {
    const expected = PermissionAction.Ask;
    const actual = getPermission({ name: 'EditFile', input: { file: '/tmp/file.ts' } }, allTools, CWD, matrix, fs);
    expect(actual).toBe(expected);
  });

  it('delete → Deny', () => {
    const expected = PermissionAction.Deny;
    const actual = getPermission({ name: 'DeleteFile', input: { path: '/tmp/file.ts' } }, allTools, CWD, matrix, fs);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Pipe
// ---------------------------------------------------------------------------

describe('getPermission — Pipe', () => {
  it('resolves to the most-restrictive action across its steps', () => {
    // read inside cwd → Approve; write outside cwd → Ask; max = Ask
    const expected = PermissionAction.Ask;
    const actual = getPermission(
      {
        name: 'Pipe',
        input: {
          steps: [
            { tool: 'ReadFile', input: { path: `${CWD}/src/file.ts` } },
            { tool: 'EditFile', input: { file: '/tmp/output.ts' } },
          ],
        },
      },
      allTools,
      CWD,
      matrix,
      fs,
    );
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// unknown tool
// ---------------------------------------------------------------------------

describe('getPermission — Pipe with a stage step', () => {
  // The stages (Read, Match, …) carry no path and are read tools; once present in the lookup list
  // a pipe containing them must resolve to read, not the not-found Deny.
  const withStages: AnyToolDefinition[] = [...allTools, toolDef('Find', 'read'), toolDef('Read', 'read'), toolDef('Match', 'read')];

  it('a pipe whose steps include a stage is not auto-denied', () => {
    const expected = PermissionAction.Approve;
    const actual = getPermission(
      {
        name: 'Pipe',
        input: {
          steps: [
            { tool: 'Find', input: { path: `${CWD}/src` } },
            { tool: 'Read', input: {} },
            { tool: 'Match', input: { pattern: 'x' } },
          ],
        },
      },
      withStages,
      CWD,
      matrix,
      fs,
    );
    expect(actual).toBe(expected);
  });
});

describe('getPermission — unknown tool', () => {
  it('unknown tool → NotFound (not Deny: a lookup failure is not a rejection)', () => {
    const expected = PermissionAction.NotFound;
    const actual = getPermission({ name: 'UnknownTool', input: {} }, allTools, CWD, matrix, fs);
    expect(actual).toBe(expected);
  });

  it('a pipe with an unknown step → NotFound (dominates over a known read step)', () => {
    const expected = PermissionAction.NotFound;
    const actual = getPermission(
      {
        name: 'Pipe',
        input: {
          steps: [
            { tool: 'ReadFile', input: { path: `${CWD}/a.ts` } },
            { tool: 'Nope', input: {} },
          ],
        },
      },
      allTools,
      CWD,
      matrix,
      fs,
    );
    expect(actual).toBe(expected);
  });
});

describe('findUnknownTools', () => {
  it('names a pipe step that has no definition', () => {
    const expected = ['Nope'];
    const actual = findUnknownTools(
      {
        name: 'Pipe',
        input: {
          steps: [
            { tool: 'ReadFile', input: {} },
            { tool: 'Nope', input: {} },
          ],
        },
      },
      allTools,
    );
    expect(actual).toEqual(expected);
  });

  it('returns empty when every step resolves', () => {
    const expected = 0;
    const actual = findUnknownTools({ name: 'Pipe', input: { steps: [{ tool: 'ReadFile', input: {} }] } }, allTools).length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ~ path expansion — gate must match door
// ---------------------------------------------------------------------------

describe('getPermission — tilde path expansion', () => {
  it('~/... resolves to outside zone when homedir is outside cwd', () => {
    // ~/secret.ts expands to /home/user/secret.ts, which is outside /project.
    // outside.write = Ask; default.write = Approve — distinct values prove the zone.
    const expected = PermissionAction.Ask;
    const actual = getPermission({ name: 'EditFile', input: { file: '~/secret.ts' } }, allTools, CWD, matrix, fs);
    expect(actual).toBe(expected);
  });
});
