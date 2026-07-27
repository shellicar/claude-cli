import { Clock } from '@js-joda/core';
import type { IHistoryReader } from '@shellicar/claude-core/history/interfaces';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { type IEnvProvider, StaticRulesConfigProvider } from '@shellicar/claude-sdk-tools/ExecV3';
import { describe, expect, it } from 'vitest';
import { createAppTools } from '../src/createAppTools.js';
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
const getAzAccounts = () => ({});
const clock = Clock.systemDefaultZone();

describe('createAppTools — tool selection', () => {
  it('includes ExecV2 when execV2 is true', () => {
    const { tools } = createAppTools({ fs, toolsConfig: { exec: false, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, getAzAccounts });

    const expected = true;
    const actual = tools.some((t) => t.name === 'ExecV2');
    expect(actual).toBe(expected);
  });

  it('excludes Exec when exec is false', () => {
    const { tools } = createAppTools({ fs, toolsConfig: { exec: false, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, getAzAccounts });

    const expected = false;
    const actual = tools.some((t) => t.name === 'Exec');
    expect(actual).toBe(expected);
  });

  it('includes Exec when exec is true', () => {
    const { tools } = createAppTools({ fs, toolsConfig: { exec: true, execV2: false, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, getAzAccounts });

    const expected = true;
    const actual = tools.some((t) => t.name === 'Exec');
    expect(actual).toBe(expected);
  });

  it('excludes ExecV2 when execV2 is false', () => {
    const { tools } = createAppTools({ fs, toolsConfig: { exec: true, execV2: false, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, getAzAccounts });

    const expected = false;
    const actual = tools.some((t) => t.name === 'ExecV2');
    expect(actual).toBe(expected);
  });

  it('includes ExecV3 when execV3 is true', () => {
    const { tools } = createAppTools({ fs, toolsConfig: { exec: false, execV2: false, execV3: true }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, getAzAccounts });

    const expected = true;
    const actual = tools.some((t) => t.name === 'ExecV3');
    expect(actual).toBe(expected);
  });

  it('excludes ExecV3 when execV3 is false', () => {
    const { tools } = createAppTools({ fs, toolsConfig: { exec: false, execV2: false, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, getAzAccounts });

    const expected = false;
    const actual = tools.some((t) => t.name === 'ExecV3');
    expect(actual).toBe(expected);
  });

  it('includes Exec when both are true', () => {
    const { tools } = createAppTools({ fs, toolsConfig: { exec: true, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, getAzAccounts });

    const expected = true;
    const actual = tools.some((t) => t.name === 'Exec');
    expect(actual).toBe(expected);
  });

  it('includes ExecV2 when both are true', () => {
    const { tools } = createAppTools({ fs, toolsConfig: { exec: true, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, getAzAccounts });

    const expected = true;
    const actual = tools.some((t) => t.name === 'ExecV2');
    expect(actual).toBe(expected);
  });
});

describe('createAppTools — TS tool availability', () => {
  it('includes TsDiagnostics when typescript is available', () => {
    const { tools } = createAppTools({ fs, toolsConfig: { exec: true, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: true, logger: noopLogger, secrets, envProvider, rulesProvider, getAzAccounts });

    const expected = true;
    const actual = tools.some((t) => t.name === 'TsDiagnostics');
    expect(actual).toBe(expected);
  });

  it('excludes TsDiagnostics when typescript is unavailable', () => {
    const { tools } = createAppTools({ fs, toolsConfig: { exec: true, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: false, logger: noopLogger, secrets, envProvider, rulesProvider, getAzAccounts });

    const expected = false;
    const actual = tools.some((t) => t.name === 'TsDiagnostics');
    expect(actual).toBe(expected);
  });

  it('excludes every TS tool when typescript is unavailable', () => {
    const { tools } = createAppTools({ fs, toolsConfig: { exec: true, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: false, logger: noopLogger, secrets, envProvider, rulesProvider, getAzAccounts });

    const expected = 0;
    const actual = tools.filter((t) => ['TsDiagnostics', 'TsHover', 'TsReferences', 'TsDefinition'].includes(t.name)).length;
    expect(actual).toBe(expected);
  });

  it('keeps non-TS tools when typescript is unavailable', () => {
    const { tools } = createAppTools({ fs, toolsConfig: { exec: true, execV2: true, execV3: false }, objects: new MemoryObjectStore(), memory: new RecordingMemoryStore(), history, currentSessionId, clock, tsAvailable: false, logger: noopLogger, secrets, envProvider, rulesProvider, getAzAccounts });

    const expected = true;
    const actual = tools.some((t) => t.name === 'EditFile');
    expect(actual).toBe(expected);
  });
});
