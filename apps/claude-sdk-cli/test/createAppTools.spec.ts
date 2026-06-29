import type { Definition, DefinitionOptions, Diagnostic, DiagnosticsOptions, HoverInfo, HoverOptions, ITypeScriptService, Reference, ReferencesOptions } from '@shellicar/claude-sdk-tools/TsService';
import { describe, expect, it } from 'vitest';
import { createAppTools } from '../src/createAppTools.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';
import { MemoryObjectStore } from './MemoryObjectStore.js';
import { RecordingMemoryStore } from './RecordingMemoryStore.js';

// createAppTools now takes the filesystem as its first parameter (the container
// passes the resolved IFileSystem instead of the nodeFs singleton).
const fs = new MemoryFileSystem({}, '/home/user', '/project');

// ITypeScriptService is a type-only export from the package entry — it has no runtime
// value there. Build a plain structural stub and cast it; no class inheritance needed.
const tsServer = {
  getDiagnostics: (_options: DiagnosticsOptions): Promise<Diagnostic[]> => Promise.resolve([]),
  getHoverInfo: (_options: HoverOptions): Promise<HoverInfo | null> => Promise.resolve(null),
  getReferences: (_options: ReferencesOptions): Promise<Reference[]> => Promise.resolve([]),
  getDefinition: (_options: DefinitionOptions): Promise<Definition[]> => Promise.resolve([]),
} as unknown as ITypeScriptService;

describe('createAppTools — tool selection', () => {
  it('includes ExecV2 when execV2 is true', () => {
    const { tools } = createAppTools(fs, tsServer, { exec: false, execV2: true, execV3: false }, new MemoryObjectStore(), new RecordingMemoryStore(), true);

    const expected = true;
    const actual = tools.some((t) => t.name === 'ExecV2');
    expect(actual).toBe(expected);
  });

  it('excludes Exec when exec is false', () => {
    const { tools } = createAppTools(fs, tsServer, { exec: false, execV2: true, execV3: false }, new MemoryObjectStore(), new RecordingMemoryStore(), true);

    const expected = false;
    const actual = tools.some((t) => t.name === 'Exec');
    expect(actual).toBe(expected);
  });

  it('includes Exec when exec is true', () => {
    const { tools } = createAppTools(fs, tsServer, { exec: true, execV2: false, execV3: false }, new MemoryObjectStore(), new RecordingMemoryStore(), true);

    const expected = true;
    const actual = tools.some((t) => t.name === 'Exec');
    expect(actual).toBe(expected);
  });

  it('excludes ExecV2 when execV2 is false', () => {
    const { tools } = createAppTools(fs, tsServer, { exec: true, execV2: false, execV3: false }, new MemoryObjectStore(), new RecordingMemoryStore(), true);

    const expected = false;
    const actual = tools.some((t) => t.name === 'ExecV2');
    expect(actual).toBe(expected);
  });

  it('includes ExecV3 when execV3 is true', () => {
    const { tools } = createAppTools(fs, tsServer, { exec: false, execV2: false, execV3: true }, new MemoryObjectStore(), new RecordingMemoryStore(), true);

    const expected = true;
    const actual = tools.some((t) => t.name === 'ExecV3');
    expect(actual).toBe(expected);
  });

  it('excludes ExecV3 when execV3 is false', () => {
    const { tools } = createAppTools(fs, tsServer, { exec: false, execV2: false, execV3: false }, new MemoryObjectStore(), new RecordingMemoryStore(), true);

    const expected = false;
    const actual = tools.some((t) => t.name === 'ExecV3');
    expect(actual).toBe(expected);
  });

  it('includes Exec when both are true', () => {
    const { tools } = createAppTools(fs, tsServer, { exec: true, execV2: true, execV3: false }, new MemoryObjectStore(), new RecordingMemoryStore(), true);

    const expected = true;
    const actual = tools.some((t) => t.name === 'Exec');
    expect(actual).toBe(expected);
  });

  it('includes ExecV2 when both are true', () => {
    const { tools } = createAppTools(fs, tsServer, { exec: true, execV2: true, execV3: false }, new MemoryObjectStore(), new RecordingMemoryStore(), true);

    const expected = true;
    const actual = tools.some((t) => t.name === 'ExecV2');
    expect(actual).toBe(expected);
  });
});

describe('createAppTools — TS tool availability', () => {
  it('includes TsDiagnostics when typescript is available', () => {
    const { tools } = createAppTools(fs, tsServer, { exec: true, execV2: true, execV3: false }, new MemoryObjectStore(), new RecordingMemoryStore(), true);

    const expected = true;
    const actual = tools.some((t) => t.name === 'TsDiagnostics');
    expect(actual).toBe(expected);
  });

  it('excludes TsDiagnostics when typescript is unavailable', () => {
    const { tools } = createAppTools(fs, tsServer, { exec: true, execV2: true, execV3: false }, new MemoryObjectStore(), new RecordingMemoryStore(), false);

    const expected = false;
    const actual = tools.some((t) => t.name === 'TsDiagnostics');
    expect(actual).toBe(expected);
  });

  it('excludes every TS tool when typescript is unavailable', () => {
    const { tools } = createAppTools(fs, tsServer, { exec: true, execV2: true, execV3: false }, new MemoryObjectStore(), new RecordingMemoryStore(), false);

    const expected = 0;
    const actual = tools.filter((t) => ['TsDiagnostics', 'TsHover', 'TsReferences', 'TsDefinition'].includes(t.name)).length;
    expect(actual).toBe(expected);
  });

  it('keeps non-TS tools when typescript is unavailable', () => {
    const { tools } = createAppTools(fs, tsServer, { exec: true, execV2: true, execV3: false }, new MemoryObjectStore(), new RecordingMemoryStore(), false);

    const expected = true;
    const actual = tools.some((t) => t.name === 'ReadFile');
    expect(actual).toBe(expected);
  });
});
