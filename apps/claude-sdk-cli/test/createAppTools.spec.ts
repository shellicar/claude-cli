import { Clock } from '@js-joda/core';
import type { IHistoryReader } from '@shellicar/claude-core/history/interfaces';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { ToolBlockLifetime } from '@shellicar/claude-sdk';
import { StaticRulesConfigProvider, type IEnvProvider } from '@shellicar/claude-sdk-tools/ExecV3';
import type { Definition, DefinitionOptions, Diagnostic, DiagnosticsOptions, HoverInfo, HoverOptions, ITypeScriptService, Reference, ReferencesOptions } from '@shellicar/claude-sdk-tools/TsService';
import { describe, expect, it } from 'vitest';
import { createAppTools } from '../src/createAppTools.js';
import { getPermission, PermissionAction, type PermissionConfig } from '../src/permissions.js';
import type { ISecrets } from '../src/secrets/Secrets.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';
import { MemoryObjectStore } from './MemoryObjectStore.js';
import { RecordingMemoryStore } from './RecordingMemoryStore.js';

// createAppTools now takes the filesystem as its first parameter (the container
// passes the resolved IFileSystem instead of the nodeFs singleton).
const fs = new MemoryFileSystem({}, '/home/user', '/project');
const noopLogger: ILogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

// The history tools only need the read seam; these tests never search, so an empty-returning stub is enough.
const history: IHistoryReader = { search: () => [], read: () => [] };
const currentSessionId = () => 'current-session';
const secrets: ISecrets = { ghHolderToken: () => 'test-holder-token', ghReaderToken: () => 'test-reader-token', azCert: () => 'test-cert' };
const envProvider: IEnvProvider = { buildEnv: (cmdEnv) => ({ ...process.env, ...cmdEnv }) };
const rulesProvider = new StaticRulesConfigProvider();
const azAccounts = {};
const clock = Clock.systemDefaultZone();

// ITypeScriptService is a type-only export from the package entry — it has no runtime
// value there. Build a plain structural stub and cast it; no class inheritance needed.
const tsServer = {
  getDiagnostics: (_options: DiagnosticsOptions): Promise<Diagnostic[]> => Promise.resolve([]),
  getHoverInfo: (_options: HoverOptions): Promise<HoverInfo | null> => Promise.resolve(null),
  getReferences: (_options: ReferencesOptions): Promise<Reference[]> => Promise.resolve([]),
  getDefinition: (_options: DefinitionOptions): Promise<Definition[]> => Promise.resolve([]),
  blockEnded: (): Promise<void> => Promise.resolve(),
} as unknown as ITypeScriptService & ToolBlockLifetime;

// A pipe's stage steps (Read, Match, …) are not registered standalone, so they are absent from
// `tools`; the permission resolver walks each step by name, so it must use `permissionTools`.
const PIPE_STAGES = ['Read', 'Match', 'Head', 'Tail', 'Range'];
const CWD = '/project';
const permMatrix: PermissionConfig = {
  default: { read: PermissionAction.Approve, write: PermissionAction.Approve, delete: PermissionAction.Ask },
  outside: { read: PermissionAction.Approve, write: PermissionAction.Ask, delete: PermissionAction.Deny },
};

describe('createAppTools — permission resolution for pipe stages', () => {
  it('exposes every pipe stage in permissionTools so a stage step resolves', () => {
    const { permissionTools } = createAppTools({ fs, tsServer, toolsConfig: { exec: false, execV2: false, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, azAccounts });

    const expected = true;
    const actual = PIPE_STAGES.every((name) => permissionTools.some((t) => t.name === name));
    expect(actual).toBe(expected);
  });

  it('does not auto-deny a pipe containing a stage', () => {
    const { permissionTools } = createAppTools({ fs, tsServer, toolsConfig: { exec: false, execV2: false, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, azAccounts });
    const pipe = {
      name: 'Pipe',
      input: {
        steps: [
          { tool: 'Find', input: { path: `${CWD}/src` } },
          { tool: 'Read', input: {} },
          { tool: 'Match', input: { pattern: 'x' } },
        ],
      },
    };

    const expected = PermissionAction.Approve;
    const actual = getPermission(pipe, permissionTools, CWD, permMatrix);
    expect(actual).toBe(expected);
  });
});

describe('createAppTools — tool selection', () => {
  it('includes ExecV2 when execV2 is true', () => {
    const { tools } = createAppTools({ fs, tsServer, toolsConfig: { exec: false, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, azAccounts });

    const expected = true;
    const actual = tools.some((t) => t.name === 'ExecV2');
    expect(actual).toBe(expected);
  });

  it('excludes Exec when exec is false', () => {
    const { tools } = createAppTools({ fs, tsServer, toolsConfig: { exec: false, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, azAccounts });

    const expected = false;
    const actual = tools.some((t) => t.name === 'Exec');
    expect(actual).toBe(expected);
  });

  it('includes Exec when exec is true', () => {
    const { tools } = createAppTools({ fs, tsServer, toolsConfig: { exec: true, execV2: false, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, azAccounts });

    const expected = true;
    const actual = tools.some((t) => t.name === 'Exec');
    expect(actual).toBe(expected);
  });

  it('excludes ExecV2 when execV2 is false', () => {
    const { tools } = createAppTools({ fs, tsServer, toolsConfig: { exec: true, execV2: false, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, azAccounts });

    const expected = false;
    const actual = tools.some((t) => t.name === 'ExecV2');
    expect(actual).toBe(expected);
  });

  it('includes ExecV3 when execV3 is true', () => {
    const { tools } = createAppTools({ fs, tsServer, toolsConfig: { exec: false, execV2: false, execV3: true }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, azAccounts });

    const expected = true;
    const actual = tools.some((t) => t.name === 'ExecV3');
    expect(actual).toBe(expected);
  });

  it('excludes ExecV3 when execV3 is false', () => {
    const { tools } = createAppTools({ fs, tsServer, toolsConfig: { exec: false, execV2: false, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, azAccounts });

    const expected = false;
    const actual = tools.some((t) => t.name === 'ExecV3');
    expect(actual).toBe(expected);
  });

  it('includes Exec when both are true', () => {
    const { tools } = createAppTools({ fs, tsServer, toolsConfig: { exec: true, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, azAccounts });

    const expected = true;
    const actual = tools.some((t) => t.name === 'Exec');
    expect(actual).toBe(expected);
  });

  it('includes ExecV2 when both are true', () => {
    const { tools } = createAppTools({ fs, tsServer, toolsConfig: { exec: true, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, azAccounts });

    const expected = true;
    const actual = tools.some((t) => t.name === 'ExecV2');
    expect(actual).toBe(expected);
  });
});

describe('createAppTools — TS tool availability', () => {
  it('includes TsDiagnostics when typescript is available', () => {
    const { tools } = createAppTools({ fs, tsServer, toolsConfig: { exec: true, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, azAccounts });

    const expected = true;
    const actual = tools.some((t) => t.name === 'TsDiagnostics');
    expect(actual).toBe(expected);
  });

  it('excludes TsDiagnostics when typescript is unavailable', () => {
    const { tools } = createAppTools({ fs, tsServer, toolsConfig: { exec: true, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: false, logger: noopLogger, secrets, envProvider, rulesProvider, azAccounts });

    const expected = false;
    const actual = tools.some((t) => t.name === 'TsDiagnostics');
    expect(actual).toBe(expected);
  });

  it('excludes every TS tool when typescript is unavailable', () => {
    const { tools } = createAppTools({ fs, tsServer, toolsConfig: { exec: true, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: false, logger: noopLogger, secrets, envProvider, rulesProvider, azAccounts });

    const expected = 0;
    const actual = tools.filter((t) => ['TsDiagnostics', 'TsHover', 'TsReferences', 'TsDefinition'].includes(t.name)).length;
    expect(actual).toBe(expected);
  });

  it('keeps non-TS tools when typescript is unavailable', () => {
    const { tools } = createAppTools({ fs, tsServer, toolsConfig: { exec: true, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: false, logger: noopLogger, secrets, envProvider, rulesProvider, azAccounts });

    const expected = true;
    const actual = tools.some((t) => t.name === 'ReadFile');
    expect(actual).toBe(expected);
  });
});
