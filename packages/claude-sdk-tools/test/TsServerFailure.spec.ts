import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ITsServerClient } from '../src/typescript/ITsServerClient';
import { resolveTsServerPath } from '../src/typescript/TsServerClient';
import { TsServerError } from '../src/typescript/TsServerError';
import { buildTsClient } from './buildTsBridge';

// The mission's core promise: a failed tsserver request must surface as a
// server-side failure, never read as a clean file. These drive the client
// directly, where the guard lives (getSyntacticDiagnostics throws on
// !res.success), across both a broken server and a working one.
describe('a failed tsserver request does not read as clean', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ts-fail-'));
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }));
    writeFileSync(path.join(dir, 'sample.ts'), 'export const answer: number = 42;\n');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws TsServerError when the server cannot answer', async () => {
    // A tsserverPath pointing at nothing: node spawns, fails to load the
    // script, and exits — the request can never be answered.
    const bogusPath = path.join(dir, 'no-such-tsserver.js');
    const client: ITsServerClient = buildTsClient(bogusPath, dir);
    await client.start();

    const actual = client.getSyntacticDiagnostics(path.join(dir, 'sample.ts'));

    await expect(actual).rejects.toBeInstanceOf(TsServerError);
    client.stop();
  }, 10_000);

  it('returns no diagnostics for a genuinely clean file', async () => {
    const client: ITsServerClient = buildTsClient(resolveTsServerPath(), dir);
    await client.start();
    const samplePath = path.join(dir, 'sample.ts');
    await client.open(samplePath, dir);

    const syntactic = await client.getSyntacticDiagnostics(samplePath);
    const semantic = await client.getSemanticDiagnostics(samplePath);
    const actual = [...syntactic, ...semantic];

    expect(actual).toEqual([]);
    client.stop();
  }, 30_000);
});
