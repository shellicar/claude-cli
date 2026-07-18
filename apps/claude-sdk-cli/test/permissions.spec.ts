import { pathSchema } from '@shellicar/claude-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { PermissionConfig, PermissionTool } from '../src/permissions.js';
import { findUnknownTools, getPermission, PermissionAction } from '../src/permissions.js';

const CWD = '/project';

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

// getPermission locates a tool's paths via its schema's isPath marker. Paths arrive already expanded
// (the SDK replaced them in place upstream), so getPermission does no expansion — the stub only needs
// a real marked schema so the marked field can be found and zoned by cwd.
function toolDef(name: string, operation: 'read' | 'write' | 'delete' | 'escalate', input_schema: PermissionTool['input_schema']): PermissionTool {
  return { name, operation, input_schema };
}

const readFileSchema = z.object({ path: pathSchema });
const editFileSchema = z.object({ file: pathSchema });
const deleteFileSchema = z.object({ files: z.array(pathSchema) });

const allTools: PermissionTool[] = [toolDef('ReadFile', 'read', readFileSchema), toolDef('EditFile', 'write', editFileSchema), toolDef('DeleteFile', 'delete', deleteFileSchema)];

// ---------------------------------------------------------------------------
// inside cwd
// ---------------------------------------------------------------------------

describe('getPermission — inside cwd', () => {
  it('read → Approve', () => {
    const expected = PermissionAction.Approve;
    const actual = getPermission({ name: 'ReadFile', input: { path: `${CWD}/src/file.ts` } }, allTools, CWD, matrix);
    expect(actual).toBe(expected);
  });

  it('write → Approve', () => {
    const expected = PermissionAction.Approve;
    const actual = getPermission({ name: 'EditFile', input: { file: `${CWD}/src/file.ts` } }, allTools, CWD, matrix);
    expect(actual).toBe(expected);
  });

  it('delete → Ask', () => {
    const expected = PermissionAction.Ask;
    const actual = getPermission({ name: 'DeleteFile', input: { files: [`${CWD}/src/file.ts`] } }, allTools, CWD, matrix);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// outside cwd
// ---------------------------------------------------------------------------

describe('getPermission — outside cwd', () => {
  it('read → Approve', () => {
    const expected = PermissionAction.Approve;
    const actual = getPermission({ name: 'ReadFile', input: { path: '/tmp/file.ts' } }, allTools, CWD, matrix);
    expect(actual).toBe(expected);
  });

  it('write → Ask', () => {
    const expected = PermissionAction.Ask;
    const actual = getPermission({ name: 'EditFile', input: { file: '/tmp/file.ts' } }, allTools, CWD, matrix);
    expect(actual).toBe(expected);
  });

  it('delete → Deny', () => {
    const expected = PermissionAction.Deny;
    const actual = getPermission({ name: 'DeleteFile', input: { files: ['/tmp/file.ts'] } }, allTools, CWD, matrix);
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
    );
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Pipe with a stage step
// ---------------------------------------------------------------------------

describe('getPermission — Pipe with a stage step', () => {
  // The stages (Read, Match, …) carry no path and are read tools; once present in the lookup list
  // a pipe containing them must resolve to read, not the not-found Deny.
  const withStages: PermissionTool[] = [...allTools, toolDef('Find', 'read', z.object({ path: pathSchema })), toolDef('Read', 'read', z.object({})), toolDef('Match', 'read', z.object({ pattern: z.string().optional() }))];

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
    );
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// unknown tool
// ---------------------------------------------------------------------------

describe('getPermission — unknown tool', () => {
  it('unknown tool → NotFound (not Deny: a lookup failure is not a rejection)', () => {
    const expected = PermissionAction.NotFound;
    const actual = getPermission({ name: 'UnknownTool', input: {} }, allTools, CWD, matrix);
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
// already-expanded path — the gate reads the replaced value
// ---------------------------------------------------------------------------

describe('getPermission — reads the replaced (already-expanded) path', () => {
  it('an outside absolute path resolves to the outside zone', () => {
    // ~ / $VAR expansion now happens upstream (the SDK replaces the marked path in place before the
    // permission check reads it), so the gate is handed the expanded /home/user/secret.ts directly,
    // which is outside /project. outside.write = Ask; default.write = Approve — distinct values prove the zone.
    const expected = PermissionAction.Ask;
    const actual = getPermission({ name: 'EditFile', input: { file: '/home/user/secret.ts' } }, allTools, CWD, matrix);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// escalate — never reachable as Approve, regardless of config
// ---------------------------------------------------------------------------

describe('getPermission — escalate operation', () => {
  // A matrix where every zone/operation is set to auto-approve, the way an autoApproveEdits-style
  // config would configure ordinary writes. An escalate tool must still resolve to Ask: the whole
  // point is that no config value, zone included, can turn it into Approve.
  const autoApproveEverything: PermissionConfig = {
    default: { read: PermissionAction.Approve, write: PermissionAction.Approve, delete: PermissionAction.Approve },
    outside: { read: PermissionAction.Approve, write: PermissionAction.Approve, delete: PermissionAction.Approve },
  };
  const escalateTools: PermissionTool[] = [toolDef('GitHub_PullRequest_Create', 'escalate', z.object({ title: z.string(), body: z.string(), base: z.string() }))];

  it('resolves to Ask even when the matrix auto-approves every other operation', () => {
    const expected = PermissionAction.Ask;
    const actual = getPermission({ name: 'GitHub_PullRequest_Create', input: { title: 'x', body: 'y', base: 'main' } }, escalateTools, CWD, autoApproveEverything);
    expect(actual).toBe(expected);
  });

  it('resolves to Ask under the ordinary matrix too, independent of zone', () => {
    const expected = PermissionAction.Ask;
    const actual = getPermission({ name: 'GitHub_PullRequest_Create', input: { title: 'x', body: 'y', base: 'main' } }, escalateTools, CWD, matrix);
    expect(actual).toBe(expected);
  });
});
