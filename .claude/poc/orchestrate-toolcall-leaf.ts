// Scratch POC, step 7 — a real ToolCall leaf, wrapping the actual Find and DeleteFile tools
// (not dummies), run through the plan/execute engine against real scratch files. Recreates
// find | xargs rm — the exact case that started this whole design conversation.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Find } from '../../packages/claude-sdk-tools/dist/esm/Find.js';
import { DeleteFile } from '../../packages/claude-sdk-tools/dist/esm/DeleteFile.js';

type Stream<T> = AsyncGenerator<T, void, unknown>;
type FsOperation = 'fs.list' | 'fs.read' | 'fs.write' | 'fs.delete' | 'fs.exec';

type LeafResult<TOut> = { stdout: Stream<TOut>; success: () => boolean };
type Leaf<TIn, TOut> = {
  name: string;
  operation: 'none' | FsOperation;
  run: (input: TIn, upstream: Stream<unknown> | AsyncIterable<unknown> | undefined, stderr: string[]) => LeafResult<TOut>;
};

type StageInput = { leaf: Leaf<unknown, unknown>; input: unknown };
type ApprovalGrant = { tiers: Set<FsOperation> };
type PlannedStage = { name: string; operation: Leaf<unknown, unknown>['operation']; mode: 'stream' | 'buffer-then-gate' };

function plan(stages: StageInput[], grant: ApprovalGrant): PlannedStage[] {
  return stages.map(({ leaf }) => {
    const needsGate = leaf.operation !== 'none' && !grant.tiers.has(leaf.operation as FsOperation);
    return { name: leaf.name, operation: leaf.operation, mode: needsGate ? 'buffer-then-gate' : 'stream' };
  });
}

async function* asAsyncIterable<T>(values: T[]): Stream<T> {
  for (const v of values) yield v;
}

async function execute(stages: StageInput[], planned: PlannedStage[]): Promise<{ result: unknown[]; log: string[] }> {
  let upstream: Stream<unknown> | AsyncIterable<unknown> | undefined;
  const log: string[] = [];

  for (let i = 0; i < stages.length; i++) {
    const { leaf, input } = stages[i];
    const stagePlan = planned[i];
    const stderr: string[] = [];

    let sourceForRun: Stream<unknown> | AsyncIterable<unknown> | undefined = upstream;
    if (stagePlan.mode === 'buffer-then-gate') {
      const buffered: unknown[] = [];
      if (upstream != null) for await (const value of upstream) buffered.push(value);
      log.push(`GATE (${stagePlan.name}): approve on ${JSON.stringify(buffered)}? (simulated: yes)`);
      sourceForRun = buffered.length > 0 ? asAsyncIterable(buffered) : upstream;
    }

    const leafResult = leaf.run(input, sourceForRun, stderr);
    const drained: unknown[] = [];
    for await (const value of leafResult.stdout) drained.push(value);
    upstream = asAsyncIterable(drained);
    log.push(`${leaf.name}: success=${leafResult.success()} stdout=${JSON.stringify(drained)} stderr=${JSON.stringify(stderr)}`);
  }

  const out: unknown[] = [];
  if (upstream != null) for await (const value of upstream) out.push(value);
  return { result: out, log };
}

// --- Real ToolCall leaves, wrapping the actual Find/DeleteFile tool objects. ---

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

const deleteFileLeaf: Leaf<{ files?: string[] }, string> = {
  name: 'DeleteFile',
  operation: 'fs.delete',
  run: (input, upstream, stderr) => {
    let ok = true;
    return {
      stdout: (async function* () {
        const files: string[] = [];
        if (input.files) files.push(...input.files);
        if (upstream != null) for await (const value of upstream) files.push(value as string);
        try {
          const { textContent } = await DeleteFile.handler({ files });
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

async function main() {
  const scratchDir = await mkdtemp(join(tmpdir(), 'orchestrate-poc-'));
  try {
    await writeFile(join(scratchDir, 'a.tmp'), 'x');
    await writeFile(join(scratchDir, 'b.tmp'), 'x');
    await writeFile(join(scratchDir, 'keep.txt'), 'x');
    console.log(`scratch dir: ${scratchDir}`);

    console.log("\n=== Real Find | DeleteFile, grant = {'fs.list'} only — delete is gated ===");
    {
      const stages: StageInput[] = [
        { leaf: findLeaf as Leaf<unknown, unknown>, input: { path: scratchDir, pattern: '\\.tmp$' } },
        { leaf: deleteFileLeaf as Leaf<unknown, unknown>, input: {} },
      ];
      const planned = plan(stages, { tiers: new Set(['fs.list']) });
      const { result, log } = await execute(stages, planned);
      console.log(log.join('\n'));
      console.log('final result:', result);
      console.log(result.length === 2 ? 'PASS: exactly the two .tmp files were deleted, for real, on disk' : `FAIL: expected 2, got ${result.length}`);
    }
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
    console.log(`\ncleaned up scratch dir: ${scratchDir}`);
  }
}

main();
