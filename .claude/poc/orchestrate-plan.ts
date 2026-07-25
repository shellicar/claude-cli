// Scratch POC, step 3 — plan-then-execute. Orchestrate computes a full plan up front (which
// stages buffer/gate, which stream) before anything runs, instead of each leaf deciding for
// itself mid-execution. The engine drives leaves according to the plan; leaves stay simple.

type Stream<T> = AsyncGenerator<T, void, unknown>;

// A leaf no longer knows about gating at all — it just transforms a stream (or produces one).
type FsOperation = 'fs.list' | 'fs.read' | 'fs.write' | 'fs.delete' | 'fs.exec';

type Leaf<TIn, TOut> = {
  name: string;
  operation: 'none' | FsOperation;
  run: (input: TIn, upstream: Stream<unknown> | AsyncIterable<unknown> | undefined, log: (msg: string) => void) => Stream<TOut>;
};

type StageInput = { leaf: Leaf<unknown, unknown>; input: unknown };

// What's approved for this run — which operation tiers are pre-trusted. Known before execution.
type ApprovalGrant = { tiers: Set<FsOperation> };

type PlannedStage = {
  name: string;
  operation: Leaf<unknown, unknown>['operation'];
  mode: 'stream' | 'buffer-then-gate';
};

// --- Planning: purely a function of the declared shape + the grant. No execution happens here. ---
function plan(stages: StageInput[], grant: ApprovalGrant): PlannedStage[] {
  return stages.map(({ leaf }) => {
    const needsGate = leaf.operation !== 'none' && !grant.tiers.has(leaf.operation as FsOperation);
    return { name: leaf.name, operation: leaf.operation, mode: needsGate ? 'buffer-then-gate' : 'stream' };
  });
}

function printPlan(planned: PlannedStage[]) {
  console.log('PLAN:');
  for (const stage of planned) {
    console.log(`  ${stage.name} [${stage.operation}] -> ${stage.mode}`);
  }
}

// --- Execution: strictly follows the plan. Leaves never see gating logic. ---
async function execute(stages: StageInput[], planned: PlannedStage[], log: (msg: string) => void): Promise<unknown[]> {
  let upstream: Stream<unknown> | AsyncIterable<unknown> | undefined;

  for (let i = 0; i < stages.length; i++) {
    const { leaf, input } = stages[i];
    const stagePlan = planned[i];

    if (stagePlan.mode === 'buffer-then-gate') {
      const buffered: unknown[] = [];
      if (upstream != null) {
        for await (const value of upstream) buffered.push(value);
      }
      log(`GATE (${stagePlan.name}): approve on ${JSON.stringify(buffered)}? (simulated: yes)`);
      // Buffered array is itself a valid AsyncIterable, so the leaf's `run` doesn't need to
      // know or care whether it's being handed a live stream or a resolved array.
      upstream = leaf.run(input, buffered.length > 0 ? asAsyncIterable(buffered) : upstream, log);
    } else {
      upstream = leaf.run(input, upstream, log);
    }
  }

  const out: unknown[] = [];
  if (upstream != null) {
    for await (const value of upstream) out.push(value);
  }
  return out;
}

async function* asAsyncIterable<T>(values: T[]): Stream<T> {
  for (const v of values) yield v;
}

// --- Leaves: simple now, no gating knowledge at all. ---

const emitterLeaf: Leaf<{ from: number }, number> = {
  name: 'DummyEmitter',
  operation: 'none',
  run: async function* ({ from }, _upstream, log) {
    let i = from;
    try {
      while (true) {
        log(`${this.name}: produce ${i}`);
        yield i;
        i++;
      }
    } finally {
      log(`${this.name}: cleaned up (stopped being pulled)`);
    }
  },
};

const headLeaf: Leaf<{ n: number }, number> = {
  name: 'Head',
  operation: 'none',
  run: async function* ({ n }, upstream, log) {
    if (upstream == null) throw new Error('Head needs an upstream stream');
    let count = 0;
    for await (const value of upstream as AsyncIterable<number>) {
      log(`${this.name}: consume ${value}`);
      yield value;
      count++;
      if (count >= n) {
        if ('return' in (upstream as AsyncGenerator<number>)) await (upstream as AsyncGenerator<number>).return(undefined);
        return;
      }
    }
  },
};

const namesLeaf: Leaf<Record<string, never>, string> = {
  name: 'Names',
  operation: 'fs.list',
  run: async function* (_input, _upstream, log) {
    for (const v of ['a.txt', 'b.txt', 'c.txt']) {
      log(`${this.name}: produce ${v}`);
      yield v;
    }
  },
};

const deleteLeaf: Leaf<Record<string, never>, string> = {
  name: 'DummyDelete',
  operation: 'fs.delete',
  run: async function* (_input, upstream, log) {
    if (upstream == null) throw new Error('DummyDelete needs an upstream stream');
    for await (const value of upstream as AsyncIterable<string>) {
      log(`${this.name}: act on ${value}`);
      yield value;
    }
  },
};

async function main() {
  console.log('=== Run A: DummyEmitter | Head(3), grant = {} (Head has no operation tier, always streams) ===');
  {
    const stages: StageInput[] = [
      { leaf: emitterLeaf as Leaf<unknown, unknown>, input: { from: 1 } },
      { leaf: headLeaf as Leaf<unknown, unknown>, input: { n: 3 } },
    ];
    const grant: ApprovalGrant = { tiers: new Set() };
    const planned = plan(stages, grant);
    printPlan(planned);
    const log = (msg: string) => console.log(msg);
    console.log('result:', await execute(stages, planned, log));
  }

  console.log("\n=== Run B: Names | DummyDelete, grant = {'fs.list'} only — delete is gated ===");
  {
    const stages: StageInput[] = [
      { leaf: namesLeaf as Leaf<unknown, unknown>, input: {} },
      { leaf: deleteLeaf as Leaf<unknown, unknown>, input: {} },
    ];
    const grant: ApprovalGrant = { tiers: new Set(['fs.list']) };
    const planned = plan(stages, grant);
    printPlan(planned);
    const log = (msg: string) => console.log(msg);
    console.log('result:', await execute(stages, planned, log));
  }

  console.log("\n=== Run C: Names | DummyDelete, grant = {'fs.list','fs.delete'} — delete pre-trusted, streams ===");
  {
    const stages: StageInput[] = [
      { leaf: namesLeaf as Leaf<unknown, unknown>, input: {} },
      { leaf: deleteLeaf as Leaf<unknown, unknown>, input: {} },
    ];
    const grant: ApprovalGrant = { tiers: new Set(['fs.list', 'fs.delete']) };
    const planned = plan(stages, grant);
    printPlan(planned);
    const log = (msg: string) => console.log(msg);
    console.log('result:', await execute(stages, planned, log));
  }
}

main();
