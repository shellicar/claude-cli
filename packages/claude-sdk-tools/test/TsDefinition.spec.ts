import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TsServerService } from '../src/typescript/TsServerService';

const fixtureDir = path.resolve(__dirname, 'fixtures/ts-project');

describe('TsDefinition', () => {
  let service: TsServerService;

  beforeAll(async () => {
    service = new TsServerService({ cwd: fixtureDir });
    await service.start();
  }, 30_000);

  afterAll(() => {
    service.stop();
  });

  describe('navigating to definitions', () => {
    it('navigates from usage to definition in another file', async () => {
      // Line 3, char 21: `Greeter` in `const greeter = new Greeter('Hello');` in main.ts
      const actual = await service.getDefinition({ file: 'main.ts', line: 3, character: 21 });
      const greeterFile = path.resolve(fixtureDir, 'greeter.ts');
      expect(actual.length).toBeGreaterThanOrEqual(1);
      const expected = actual.some((def) => def.file === greeterFile);
      expect(expected).toBe(true);
    });

    it('returns the definition location for an imported symbol', async () => {
      // Line 1, char 10: `Greeter` in the import statement in main.ts
      const actual = await service.getDefinition({ file: 'main.ts', line: 1, character: 10 });
      const greeterFile = path.resolve(fixtureDir, 'greeter.ts');
      expect(actual.length).toBeGreaterThanOrEqual(1);
      const expected = actual.some((def) => def.file === greeterFile && def.line === 2);
      expect(expected).toBe(true);
    });

    it('returns the definition for a method call', async () => {
      // Line 4, char 25: `greet` in `greeter.greet('World')` in main.ts
      const actual = await service.getDefinition({ file: 'main.ts', line: 4, character: 25 });
      const greeterFile = path.resolve(fixtureDir, 'greeter.ts');
      expect(actual.length).toBeGreaterThanOrEqual(1);
      // greet is defined at line 11 in greeter.ts
      const expected = actual.some((def) => def.file === greeterFile && def.line === 11);
      expect(expected).toBe(true);
    });
  });
});
