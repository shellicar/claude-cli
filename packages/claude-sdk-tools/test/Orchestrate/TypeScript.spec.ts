import type { Stream } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createTsToolsV2 } from '../../src/Orchestrate/tools/TypeScript.js';
import type { Diagnostic, ITypeScriptService } from '../../src/typescript/ITypeScriptService.js';
import { fakeScope } from '../helpers.js';

async function drain(stream: Stream<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of stream) {
    out.push(value);
  }
  return out;
}

const stubService = (overrides: Partial<ITypeScriptService>): ITypeScriptService => ({
  getDiagnostics: async () => [],
  getHoverInfo: async () => null,
  getReferences: async () => [],
  getDefinition: async () => [],
  ...overrides,
});

function findTool(name: string) {
  const tool = createTsToolsV2().find((t) => t.name === name);
  if (tool == null) {
    throw new Error(`no such tool: ${name}`);
  }
  return tool;
}

describe('TypeScript V2 tools', () => {
  describe('TsDiagnostics', () => {
    it('yields one grep-style line per diagnostic', async () => {
      const diagnostics: Diagnostic[] = [{ file: '/abs/View.ts', line: 1, character: 5, message: 'boom', code: 2322, severity: 'error' }];
      const tool = findTool('TsDiagnostics');

      const result = tool.run({ files: ['/abs/View.ts'], severity: 'error' }, undefined, [], undefined, fakeScope(stubService({ getDiagnostics: async () => diagnostics })));
      const lines = await drain(result.stdout);

      expect(lines).toEqual(['/abs/View.ts:1:5: [error] boom (2322)']);
    });

    // The shape a `Find | Xargs files | TsDiagnostics` pipeline can actually produce: paths, and
    // one filter for the call.
    it('checks every file it was given', async () => {
      const checked: string[] = [];
      const tool = findTool('TsDiagnostics');

      const result = tool.run(
        { files: ['/abs/One.ts', '/abs/Two.ts'], severity: 'error' },
        undefined,
        [],
        undefined,
        fakeScope(
          stubService({
            getDiagnostics: async ({ file }) => {
              checked.push(file);
              return [];
            },
          }),
        ),
      );
      await drain(result.stdout);

      const expected = ['/abs/One.ts', '/abs/Two.ts'];
      const actual = checked;
      expect(actual).toEqual(expected);
    });

    it('applies the call severity to every file, rather than one per file', async () => {
      const applied: string[] = [];
      const tool = findTool('TsDiagnostics');

      const result = tool.run(
        { files: ['/abs/One.ts', '/abs/Two.ts'], severity: 'warning' },
        undefined,
        [],
        undefined,
        fakeScope(
          stubService({
            getDiagnostics: async ({ severity }) => {
              applied.push(String(severity));
              return [];
            },
          }),
        ),
      );
      await drain(result.stdout);

      const expected = ['warning', 'warning'];
      const actual = applied;
      expect(actual).toEqual(expected);
    });

    it('rejects when no scope is supplied', async () => {
      const tool = findTool('TsDiagnostics');

      const result = tool.run({ files: ['/abs/View.ts'], severity: 'error' }, undefined, []);

      await expect(drain(result.stdout)).rejects.toThrow('TsDiagnostics requires a batch scope to resolve ITypeScriptService');
    });
  });

  describe('TsHover', () => {
    it('yields the symbol kind and text, then any documentation', async () => {
      const tool = findTool('TsHover');
      const scope = fakeScope(stubService({ getHoverInfo: async () => ({ kind: 'const', text: 'const x: number', documentation: 'A number.' }) }));

      const result = tool.run({ file: '/abs/View.ts', line: 12, character: 8 }, undefined, [], undefined, scope);
      const lines = await drain(result.stdout);

      expect(lines).toEqual(['const: const x: number', 'A number.']);
      expect(result.success()).toBe(true);
    });

    it('reports no symbol as an unsuccessful result', async () => {
      const tool = findTool('TsHover');
      const scope = fakeScope(stubService({ getHoverInfo: async () => null }));

      const result = tool.run({ file: '/abs/View.ts', line: 12, character: 8 }, undefined, [], undefined, scope);
      const lines = await drain(result.stdout);

      expect(lines).toEqual(['No symbol at that position']);
      expect(result.success()).toBe(false);
    });
  });

  describe('TsReferences', () => {
    it('yields one grep-style line per reference', async () => {
      const tool = findTool('TsReferences');
      const scope = fakeScope(stubService({ getReferences: async () => [{ file: '/abs/View.ts', line: 5, character: 13, text: 'useThing()' }] }));

      const result = tool.run({ file: '/abs/View.ts', line: 5, character: 13 }, undefined, [], undefined, scope);
      const lines = await drain(result.stdout);

      expect(lines).toEqual(['/abs/View.ts:5:13: useThing()']);
    });
  });

  describe('TsDefinition', () => {
    it('yields one grep-style line per definition', async () => {
      const tool = findTool('TsDefinition');
      const scope = fakeScope(stubService({ getDefinition: async () => [{ file: '/abs/index.ts', line: 3, character: 20 }] }));

      const result = tool.run({ file: '/abs/View.ts', line: 3, character: 20 }, undefined, [], undefined, scope);
      const lines = await drain(result.stdout);

      expect(lines).toEqual(['/abs/index.ts:3:20']);
    });
  });
});
