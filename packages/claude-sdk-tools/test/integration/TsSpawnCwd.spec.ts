import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TsServerBridge } from '../../src/typescript/TsServerBridge';
import { buildTsBridge } from './buildTsBridge';

describe('tsserver spawn cwd is inert', () => {
  let dir: string;
  let service: TsServerBridge;

  beforeAll(() => {
    // A project far from $HOME, with a strict tsconfig and a file whose error is
    // only detectable under that project's settings.
    dir = mkdtempSync(path.join(os.tmpdir(), 'ts-cwd-'));
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }));
    writeFileSync(path.join(dir, 'sample.ts'), 'export const n: number = "oops";\n');
    // buildTsBridge sets homedir()=os.homedir() (the spawn cwd) and cwd()=dir.
    service = buildTsBridge(dir);
  });

  afterAll(async () => {
    await service.blockEnded();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the file's own project diagnostics though the server spawned in $HOME", async () => {
    const samplePath = path.join(dir, 'sample.ts');
    const expected = { file: samplePath, severity: 'error' };
    const diagnostics = await service.getDiagnostics({ file: 'sample.ts', severity: 'error' });
    const match = diagnostics.find((d) => d.file === samplePath);
    const actual = match ? { file: match.file, severity: match.severity } : undefined;

    expect(actual).toEqual(expected);
  }, 30_000);
});
