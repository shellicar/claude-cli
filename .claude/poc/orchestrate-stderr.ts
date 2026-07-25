// Scratch POC, step 5 — stdout/stderr/success as a uniform three-channel contract, carried by
// the engine, not by individual leaves. Leaves just write to whichever channel is relevant;
// whether stderr gets surfaced to the caller is Orchestrate's policy (per-node flag, or
// automatically on failure), decided centrally in execute(), never inside a leaf.

type Stream<T> = AsyncGenerator<T, void, unknown>;

type FsOperation = 'fs.list' | 'fs.read' | 'fs.write' | 'fs.delete' | 'fs.exec';

// A leaf's run now returns both channels plus a settle-able success flag, instead of a bare
// stream. stderr is always captured (a leaf writes to it via `stderr.push`, never decides
// whether it's shown) — the decision of whether to surface it lives entirely in execute().
type LeafResult<TOut> = {
  stdout: Stream<TOut>;
  stderr: string[];
  success: () => boolean; // read after stdout is fully drained — settles once the leaf finishes
};

type Leaf<TIn, TOut> = {
  name: string;
  operation: 'none' | FsOperation;
  showStderr?: boolean; // per-node flag — default false, always overridden to true on failure
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

type StageReport = { name: string; success: boolean; stderrShown: string[] | null };

// Runs the whole sequence, and for each stage decides — centrally, not per-leaf — whether
// that stage's stderr is included in the report: shown if the leaf opted in (showStderr),
// or automatically if the stage failed, regardless of the flag.
async function execute(stages: StageInput[], planned: PlannedStage[]): Promise<{ result: unknown[]; report: StageReport[] }> {
  let upstream: Stream<unknown> | AsyncIterable<unknown> | undefined;
  const report: StageReport[] = [];

  for (let i = 0; i < stages.length; i++) {
    const { leaf, input } = stages[i];
    const stagePlan = planned[i];
    const stderr: string[] = [];

    let sourceForRun: Stream<unknown> | AsyncIterable<unknown> | undefined = upstream;
    if (stagePlan.mode === 'buffer-then-gate') {
      const buffered: unknown[] = [];
      if (upstream != null) for await (const value of upstream) buffered.push(value);
      console.log(`GATE (${stagePlan.name}): approve on ${JSON.stringify(buffered)}? (simulated: yes)`);
      sourceForRun = buffered.length > 0 ? asAsyncIterable(buffered) : upstream;
    }

    const leafResult = leaf.run(input, sourceForRun, stderr);

    // Drain this stage's stdout fully before deciding success/stderr — success only settles
    // once the leaf has actually finished, same as a real process's exit code.
    const drained: unknown[] = [];
    for await (const value of leafResult.stdout) drained.push(value);
    upstream = asAsyncIterable(drained);

    const success = leafResult.success();
    const shouldShowStderr = leaf.showStderr === true || !success;
    report.push({ name: leaf.name, success, stderrShown: shouldShowStderr && stderr.length > 0 ? stderr : null });

    if (!success) break; // matches && semantics — a failed stage stops the sequence
  }

  const out: unknown[] = [];
  if (upstream != null) for await (const value of upstream) out.push(value);
  return { result: out, report };
}

// --- Leaves ---

const namesLeaf: Leaf<Record<string, never>, string> = {
  name: 'Names',
  operation: 'fs.list',
  run: (_input, _upstream, _stderr) => {
    let ok = true;
    return {
      stdout: (async function* () {
        for (const v of ['a.txt', 'b.txt', 'c.txt']) yield v;
      })(),
      stderr: [],
      success: () => ok,
    };
  },
};

// A leaf that writes real content to stderr even on success — the git-shaped case —
// and opts in to always showing it (showStderr: true), same as merge_stderr would.
const gitLikeLeaf: Leaf<Record<string, never>, string> = {
  name: 'GitLikeDiff',
  operation: 'fs.read',
  showStderr: true,
  run: (_input, _upstream, stderr) => {
    stderr.push('Switched to branch main'); // real content git puts on stderr even on success
    let ok = true;
    return {
      stdout: (async function* () {
        yield '+ added a line';
      })(),
      stderr: [],
      success: () => ok,
    };
  },
};

// A leaf that fails — proves stderr surfaces automatically on failure, without showStderr set.
const failingLeaf: Leaf<Record<string, never>, string> = {
  name: 'FailingStage',
  operation: 'fs.write',
  run: (_input, _upstream, stderr) => {
    stderr.push('permission denied: /etc/hosts');
    let ok = false;
    return {
      stdout: (async function* () {})(),
      stderr: [],
      success: () => ok,
    };
  },
};

async function main() {
  console.log('=== Run A: Names -> stdout only, stderr empty, not shown ===');
  {
    const stages: StageInput[] = [{ leaf: namesLeaf as Leaf<unknown, unknown>, input: {} }];
    const planned = plan(stages, { tiers: new Set(['fs.list']) });
    const { result, report } = await execute(stages, planned);
    console.log('result:', result);
    console.log('report:', report);
  }

  console.log("\n=== Run B: GitLikeDiff -> showStderr: true, real content on stderr even though it succeeded ===");
  {
    const stages: StageInput[] = [{ leaf: gitLikeLeaf as Leaf<unknown, unknown>, input: {} }];
    const planned = plan(stages, { tiers: new Set(['fs.read']) });
    const { result, report } = await execute(stages, planned);
    console.log('result:', result);
    console.log('report:', report);
    console.log(report[0].stderrShown != null ? 'PASS: stderr shown because showStderr: true' : 'FAIL: stderr should have been shown');
  }

  console.log('\n=== Run C: FailingStage -> showStderr NOT set, but stderr shown automatically because it failed ===');
  {
    const stages: StageInput[] = [{ leaf: failingLeaf as Leaf<unknown, unknown>, input: {} }];
    const planned = plan(stages, { tiers: new Set(['fs.write']) });
    const { result, report } = await execute(stages, planned);
    console.log('result:', result);
    console.log('report:', report);
    console.log(report[0].stderrShown != null ? 'PASS: stderr shown automatically on failure' : 'FAIL: stderr should have been shown on failure');
  }
}

main();
