import { describe, expect, it } from 'vitest';
import { createTsReferences } from '../src/TsReferences/TsReferences';
import type { ITypeScriptService, Reference } from '../src/typescript/ITypeScriptService';
import { call } from './helpers';

// A service double that returns fixed references; only getReferences is exercised.
const stubService = (references: Reference[]): ITypeScriptService => ({
  getDiagnostics: async () => [],
  getHoverInfo: async () => null,
  getReferences: async () => references,
  getDefinition: async () => [],
  blockEnded: async () => {},
});

describe('TsReferences', () => {
  describe('output shape', () => {
    it('groups references under each file path, without the path on each entry', async () => {
      const greeterFile = '/abs/path/greeter.ts';
      const mainFile = '/abs/path/main.ts';
      const references: Reference[] = [
        { file: greeterFile, line: 2, character: 14, text: 'class Greeter' },
        { file: mainFile, line: 1, character: 10, text: 'import { Greeter }' },
        { file: mainFile, line: 3, character: 21, text: 'new Greeter' },
      ];
      const expected = {
        [greeterFile]: [{ line: 2, character: 14, text: 'class Greeter' }],
        [mainFile]: [
          { line: 1, character: 10, text: 'import { Greeter }' },
          { line: 3, character: 21, text: 'new Greeter' },
        ],
      };

      const actual = await call(createTsReferences(stubService(references)), { file: greeterFile, line: 2, character: 14 });

      expect(actual).toEqual(expected);
    });

    it('returns an empty object when there are no references', async () => {
      const expected = {};

      const actual = await call(createTsReferences(stubService([])), { file: '/abs/path/main.ts', line: 7, character: 7 });

      expect(actual).toEqual(expected);
    });
  });
});
