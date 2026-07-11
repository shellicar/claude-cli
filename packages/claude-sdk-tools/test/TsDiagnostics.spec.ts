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

      const actual = await call(createTsDiagnostics(stubService(diagnostics)), { file });

      expect(actual).toEqual(expected);
    });

    it('returns an empty object when there are no diagnostics', async () => {
      const expected = {};

      const actual = await call(createTsDiagnostics(stubService([])), { file: '/abs/path/View.ts' });

      expect(actual).toEqual(expected);
    });
  });
});
