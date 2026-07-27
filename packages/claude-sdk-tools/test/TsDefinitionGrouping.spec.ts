import { describe, expect, it } from 'vitest';
import { createTsDefinition } from '../src/TsDefinition/TsDefinition';
import type { Definition, ITypeScriptService } from '../src/typescript/ITypeScriptService';
import { call, fakeScope } from './helpers';

// A service double that returns fixed definitions; only getDefinition is exercised.
const stubService = (definitions: Definition[]): ITypeScriptService => ({
  getDiagnostics: async () => [],
  getHoverInfo: async () => null,
  getReferences: async () => [],
  getDefinition: async () => definitions,
});

describe('TsDefinition', () => {
  describe('output shape', () => {
    it('groups definitions under each file path, without the path on each entry', async () => {
      const greeterFile = '/abs/path/greeter.ts';
      const definitions: Definition[] = [
        { file: greeterFile, line: 2, character: 14 },
        { file: greeterFile, line: 11, character: 3 },
      ];
      const expected = {
        [greeterFile]: [
          { line: 2, character: 14 },
          { line: 11, character: 3 },
        ],
      };

      const actual = await call(createTsDefinition(), { file: '/abs/path/main.ts', line: 3, character: 21 }, fakeScope(stubService(definitions)));

      expect(actual).toEqual(expected);
    });

    it('returns an empty object when there is no definition', async () => {
      const expected = {};

      const actual = await call(createTsDefinition(), { file: '/abs/path/main.ts', line: 9, character: 9 }, fakeScope(stubService([])));

      expect(actual).toEqual(expected);
    });
  });
});
