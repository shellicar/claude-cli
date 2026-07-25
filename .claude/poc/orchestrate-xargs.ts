// Scratch POC, step 10 — Xargs. Bridges a stream into a named parameter of the NEXT stage,
// entirely from outside that stage. The target leaf needs zero special code to accept a
// stream this way — proven by wrapping the real DeleteFile.handler completely unmodified,
// exactly as "dumb" as a real MCP tool or an external CLI would be.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeleteFile } from '../../packages/claude-sdk-tools/dist/esm/DeleteFile.js';
import { Find } from '../../packages/claude-sdk-tools/dist/esm/Find.js';
import type { Leaf, Stream } from './orchestrate-program-leaf.ts';

// A dumb leaf: only ever reads its own `input`, has no idea what upstream even is. This is
// the honest shape of wrapping a tool we don't control the interior of.
const findLeaf: Leaf<{ path: string; pattern?: string }, string> = {
  name: 'Find',
  operation: 'fs.list',
  run: (input, _upstream, stderr) => {
    let ok = true;
    return {
      stdout: (async function* () {
        try {
          const out = await Find.run({ path: input.path, pattern: input.pattern, type: 'file', exclude: ['dist', 'node_modules', '.git'], followSymlinks: true });
          for (const f of out.files) yield f.path;
        } catch (err) {
          ok = false;
          stderr.push((err as Error).message);
        }
      })(),
      success: () => ok,
    };
  },
};

// Deliberately dumb: reads only input.files, never touches upstream. Same shape as the real
// DeleteFile.handler — no bespoke "merge with whatever's piped in" logic at all.
const dumbDeleteFileLeaf: Leaf<{ files: string[] }, string> = {
  name: 'DeleteFile',
  operation: 'fs.delete',
  run: (input, _upstream, stderr) => {
    let ok = true;
    return {
      stdout: (async function* () {
        try {
          const { textContent } = await DeleteFile.handler({ files: input.files });
          for (const path of textContent.deleted) yield `deleted: ${path}`;
          for (const e of textContent.errors) {
            ok = false;
            stderr.push(`${e.path}: ${e.error}`);
          }
        } catch (err) {
          ok = false;
          stderr.push((err as Error).message);
        }
      })(),
      success: () => ok,
    };
  },
};

// --- Xargs itself: not a Leaf. It doesn't run and produce a stream — its job is to reach
// into the NEXT stage's input and populate one named field from whatever's upstream. ---
type XargsMarker = { kind: 'xargs'; parameter: string };
type RealStage = { kind: 'leaf'; leaf: Leaf<unknown, unknown>; input: Record<string, unknown> };
type Stage = RealStage | XargsMarker;

async function* asAsyncIterable<T>(values: T[]): Stream<T> {
  for (const v of values) yield v;
}

async function execute(stages: Stage[]): Promise<{ result: unknown[]; log: string[] }> {
  const log: string[] = [];
  let upstream: Stream<unknown> | AsyncIterable<unknown> | undefined;
  let pendingInjection: { parameter: string; values: unknown[] } | null = null;

  for (const stage of stages) {
    if (stage.kind === 'xargs') {
      const batch: unknown[] = [];
      if (upstream != null) for await (const value of upstream) batch.push(value);
      log.push(`Xargs: collected ${batch.length} item(s) for parameter "${stage.parameter}"`);
      pendingInjection = { parameter: stage.parameter, values: batch };
      upstream = undefined;
      continue;
    }

    // Xargs's collected batch, if any, gets injected into this stage's input right here —
    // the leaf itself never sees Xargs, never sees a stream, just a normal populated field.
    const input = pendingInjection ? { ...stage.input, [pendingInjection.parameter]: pendingInjection.values } : stage.input;
    pendingInjection = null;

    const stderr: string[] = [];
    const leafResult = stage.leaf.run(input, upstream, stderr);
    const drained: unknown[] = [];
    for await (const value of leafResult.stdout) drained.push(value);
    upstream = asAsyncIterable(drained);
    log.push(`${stage.leaf.name}: success=${leafResult.success()} input=${JSON.stringify(input)} stdout=${JSON.stringify(drained)}`);
  }

  const out: unknown[] = [];
  if (upstream != null) for await (const value of upstream) out.push(value);
  return { result: out, log };
}

async function main() {
  const scratchDir = await mkdtemp(join(tmpdir(), 'orchestrate-xargs-poc-'));
  try {
    await writeFile(join(scratchDir, 'a.tmp'), 'x');
    await writeFile(join(scratchDir, 'b.tmp'), 'x');
    await writeFile(join(scratchDir, 'keep.txt'), 'x');
    console.log(`scratch dir: ${scratchDir}\n`);

    console.log('=== Find | Xargs(parameter: files) | DeleteFile — DeleteFile has zero stream-handling code ===\n');
    const stages: Stage[] = [
      { kind: 'leaf', leaf: findLeaf as Leaf<unknown, unknown>, input: { path: scratchDir, pattern: '\\.tmp$' } },
      { kind: 'xargs', parameter: 'files' },
      { kind: 'leaf', leaf: dumbDeleteFileLeaf as Leaf<unknown, unknown>, input: {} },
    ];
    const { result, log } = await execute(stages);
    console.log(log.join('\n'));
    console.log('\nfinal result:', result);
    console.log(result.length === 2 ? 'PASS: Xargs bridged the stream into files[] with no help from DeleteFile itself' : `FAIL: expected 2, got ${result.length}`);
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
    console.log(`\ncleaned up scratch dir: ${scratchDir}`);
  }
}

main();
