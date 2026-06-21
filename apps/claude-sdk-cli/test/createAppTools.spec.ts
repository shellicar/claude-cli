import type { Definition, DefinitionOptions, Diagnostic, DiagnosticsOptions, HoverInfo, HoverOptions, ITypeScriptService, Reference, ReferencesOptions } from '@shellicar/claude-sdk-tools/TsService';
import { describe, expect, it } from 'vitest';
import { createAppTools } from '../src/createAppTools.js';
import { MemoryObjectStore } from './MemoryObjectStore.js';

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
    const { tools } = createAppTools(tsServer, { exec: false, execV2: true }, new MemoryObjectStore());

    const expected = true;
    const actual = tools.some((t) => t.name === 'ExecV2');
    expect(actual).toBe(expected);
  });

  it('excludes Exec when exec is false', () => {
    const { tools } = createAppTools(tsServer, { exec: false, execV2: true }, new MemoryObjectStore());

    const expected = false;
    const actual = tools.some((t) => t.name === 'Exec');
    expect(actual).toBe(expected);
  });

  it('includes Exec when exec is true', () => {
    const { tools } = createAppTools(tsServer, { exec: true, execV2: false }, new MemoryObjectStore());

    const expected = true;
    const actual = tools.some((t) => t.name === 'Exec');
    expect(actual).toBe(expected);
  });

  it('excludes ExecV2 when execV2 is false', () => {
    const { tools } = createAppTools(tsServer, { exec: true, execV2: false }, new MemoryObjectStore());

    const expected = false;
    const actual = tools.some((t) => t.name === 'ExecV2');
    expect(actual).toBe(expected);
  });

  it('includes Exec when both are true', () => {
    const { tools } = createAppTools(tsServer, { exec: true, execV2: true }, new MemoryObjectStore());

    const expected = true;
    const actual = tools.some((t) => t.name === 'Exec');
    expect(actual).toBe(expected);
  });

  it('includes ExecV2 when both are true', () => {
    const { tools } = createAppTools(tsServer, { exec: true, execV2: true }, new MemoryObjectStore());

    const expected = true;
    const actual = tools.some((t) => t.name === 'ExecV2');
    expect(actual).toBe(expected);
  });
});

describe('createAppTools — TS tool availability', () => {
  it('includes TsDiagnostics when typescript is available', () => {
    const { tools } = createAppTools(tsServer, { exec: true, execV2: true }, new MemoryObjectStore(), true);

    const expected = true;
    const actual = tools.some((t) => t.name === 'TsDiagnostics');
    expect(actual).toBe(expected);
  });

  it('excludes TsDiagnostics when typescript is unavailable', () => {
    const { tools } = createAppTools(tsServer, { exec: true, execV2: true }, new MemoryObjectStore(), false);

    const expected = false;
    const actual = tools.some((t) => t.name === 'TsDiagnostics');
    expect(actual).toBe(expected);
  });

  it('excludes every TS tool when typescript is unavailable', () => {
    const { tools } = createAppTools(tsServer, { exec: true, execV2: true }, new MemoryObjectStore(), false);

    const expected = 0;
    const actual = tools.filter((t) => ['TsDiagnostics', 'TsHover', 'TsReferences', 'TsDefinition'].includes(t.name)).length;
    expect(actual).toBe(expected);
  });

  it('keeps non-TS tools when typescript is unavailable', () => {
    const { tools } = createAppTools(tsServer, { exec: true, execV2: true }, new MemoryObjectStore(), false);

    const expected = true;
    const actual = tools.some((t) => t.name === 'ReadFile');
    expect(actual).toBe(expected);
  });
});
