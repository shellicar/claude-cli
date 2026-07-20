import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TsServerBridge } from '../../src/typescript/TsServerBridge';
import { buildTsBridge } from './buildTsBridge';

describe('TsDiagnostics freshness', () => {
  let dir: string;
  let service: TsServerBridge;

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ts-fresh-'));
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }));
    writeFileSync(path.join(dir, 'sample.ts'), 'export const answer: number = 42;\n');
    service = buildTsBridge(dir);
  });

  afterAll(async () => {
    await service.blockEnded();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reflects an on-disk edit after the block ends', async () => {
    const before = await service.getDiagnostics({ file: 'sample.ts', severity: 'error' });
    expect(before.length).toBe(0);

    // Block boundary: dispose the first server. The next call spawns fresh and
    // reads disk.
    await service.blockEnded();

    // Introduce a type error on disk: assigning a string to a number-typed
    // const produces TS2322 (Type 'string' is not assignable to type 'number').
    writeFileSync(path.join(dir, 'sample.ts'), 'export const answer: number = "not a number";\n');

    const samplePath = path.join(dir, 'sample.ts');
    const expected = { file: samplePath, code: 2322, severity: 'error' };
    const after = await service.getDiagnostics({ file: 'sample.ts', severity: 'error' });
    const match = after.find((d) => d.code === 2322);
    const actual = match ? { file: match.file, code: match.code, severity: match.severity } : undefined;

    expect(actual).toEqual(expected);
  }, 30_000);
});
