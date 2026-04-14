import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TsServerService } from '../src/typescript/TsServerService';

const fixtureDir = path.resolve(__dirname, 'fixtures/ts-project');

describe('TsHover', () => {
  let service: TsServerService;

  beforeAll(async () => {
    service = new TsServerService({ cwd: fixtureDir });
    await service.start();
  }, 30_000);

  afterAll(() => {
    service.stop();
  });

  describe('type info', () => {
    it('returns type info for a variable at a known position', async () => {
      // Line 3, char 7: `greeter` in `const greeter = new Greeter('Hello');`
      const actual = await service.getHoverInfo({ file: 'main.ts', line: 3, character: 7 });
      expect(actual).not.toBeNull();
      expect(actual?.text).toContain('Greeter');
      expect(actual?.kind).toBeTruthy();
    });

    it('returns null for a position with no symbol', async () => {
      // Line 6: `// A standalone variable with no references` — inside a comment
      const actual = await service.getHoverInfo({ file: 'main.ts', line: 6, character: 5 });
      expect(actual).toBeNull();
    });

    it('includes documentation when present', async () => {
      // Line 2, char 14: `Greeter` in `export class Greeter {` — has JSDoc
      const actual = await service.getHoverInfo({ file: 'greeter.ts', line: 2, character: 14 });
      expect(actual).not.toBeNull();
      expect(actual?.documentation).toBeTruthy();
      expect(actual?.documentation).toContain('greeting service');
    });
  });
});
