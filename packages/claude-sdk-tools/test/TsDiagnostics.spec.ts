import { describe, expect, it } from 'vitest';
import { createTsDiagnostics } from '../src/TsDiagnostics/TsDiagnostics';
import type { Diagnostic, ITypeScriptService } from '../src/typescript/ITypeScriptService';
import { call } from './helpers';

// A service double that returns fixed diagnostics; only getDiagnostics is exercised.
const stubService = (diagnostics: Diagnostic[]): ITypeScriptService => ({
  getDiagnostics: async () => diagnostics,
  getHoverInfo: async () => null,
  getReferences: async () => [],
  getDefinition: async () => [],
  blockEnded: async () => {},
});

// A service double that answers per file, so a batch of files gets each file's own diagnostics.
const stubServiceByFile = (byFile: Record<string, Diagnostic[]>): ITypeScriptService => ({
  getDiagnostics: async ({ file }) => byFile[file] ?? [],
  getHoverInfo: async () => null,
  getReferences: async () => [],
  getDefinition: async () => [],
  blockEnded: async () => {},
});

describe('TsDiagnostics', () => {
  describe('output shape', () => {
    it('groups diagnostics under the file path, without the path on each entry', async () => {
      const file = '/abs/path/View.ts';
      const diagnostics: Diagnostic[] = [
        { file, line: 1, character: 5, message: 'first', code: 2322, severity: 'error' },
        { file, line: 8, character: 2, message: 'second', code: 2345, severity: 'error' },
      ];
      const expected = {
        [file]: [
          { line: 1, character: 5, message: 'first', code: 2322, severity: 'error' },
          { line: 8, character: 2, message: 'second', code: 2345, severity: 'error' },
        ],
      };

      const actual = await call(createTsDiagnostics(stubService(diagnostics)), { files: [{ file }] });

      expect(actual).toEqual(expected);
    });

    it('returns an empty object when there are no diagnostics', async () => {
      const expected = {};

      const actual = await call(createTsDiagnostics(stubService([])), { files: [{ file: '/abs/path/View.ts' }] });

      expect(actual).toEqual(expected);
    });

    it('groups a multi-file batch under each file\u2019s own path', async () => {
      const viewFile = '/abs/path/View.ts';
      const mainFile = '/abs/path/main.ts';
      const byFile: Record<string, Diagnostic[]> = {
        [viewFile]: [{ file: viewFile, line: 1, character: 5, message: 'view error', code: 2322, severity: 'error' }],
        [mainFile]: [{ file: mainFile, line: 3, character: 1, message: 'main error', code: 2345, severity: 'error' }],
      };
      const expected = {
        [viewFile]: [{ line: 1, character: 5, message: 'view error', code: 2322, severity: 'error' }],
        [mainFile]: [{ line: 3, character: 1, message: 'main error', code: 2345, severity: 'error' }],
      };

      const actual = await call(createTsDiagnostics(stubServiceByFile(byFile)), { files: [{ file: viewFile }, { file: mainFile }] });

      expect(actual).toEqual(expected);
    });
  });
});
