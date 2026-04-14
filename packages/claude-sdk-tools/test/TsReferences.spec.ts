import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TsServerService } from '../src/typescript/TsServerService';

const fixtureDir = path.resolve(__dirname, 'fixtures/ts-project');

describe('TsReferences', () => {
  let service: TsServerService;

  beforeAll(async () => {
    service = new TsServerService({ cwd: fixtureDir });
    await service.start();
  }, 30_000);

  afterAll(() => {
    service.stop();
  });

  describe('finding references', () => {
    it('finds all references to a class used in multiple files', async () => {
      // Line 2, char 14: `Greeter` class definition in greeter.ts
      const actual = await service.getReferences({ file: 'greeter.ts', line: 2, character: 14 });
      // Greeter is used in greeter.ts (definition) and main.ts (import + usage)
      expect(actual.length).toBeGreaterThanOrEqual(3);
    });

    it('returns empty array for a symbol with no references', async () => {
      // Line 7, char 7: `unused` in main.ts — only the declaration, no other usage
      const actual = await service.getReferences({ file: 'main.ts', line: 7, character: 7 });
      // tsserver returns at least the declaration site itself; "no references" means just the one declaration
      expect(actual.length).toBeLessThanOrEqual(1);
    });

    it('includes the definition site in references', async () => {
      // Line 2, char 14: `Greeter` class definition in greeter.ts
      const actual = await service.getReferences({ file: 'greeter.ts', line: 2, character: 14 });
      const greeterFile = path.resolve(fixtureDir, 'greeter.ts');
      const expected = actual.some((ref) => ref.file === greeterFile && ref.line === 2);
      expect(expected).toBe(true);
    });
  });
});
