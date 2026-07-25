// Scratch POC, step 2 — wire the proven mechanics (orchestrate-streaming.ts) into something
// resembling a real tool-call invocation. Deliberately loose: this is here to find out what
// shape a "tool" needs to have, not to commit to one. Expect this to be wrong and thrown away.

type Stream<T> = AsyncGenerator<T, void, unknown>;

// A guess at the smallest possible "leaf" shape: a name, and a function from (input, upstream
// stream | undefined) to an output stream. Nothing about schema, approval wiring, or registration
// yet — those are exactly the things we don't know until this has been used for real.
type Leaf<TIn, TOut> = {
  name: string;
  gated: boolean; // stands in for "does this leaf's tier require an approval gate on this run"
  run: (input: TIn, upstream: Stream<unknown> | undefined, log: (msg: string) => void) => Stream<TOut>;
};

// --- Reuse the two dummy behaviours from step 1, reshaped as leaves. ---

const emitterLeaf: Leaf<{ from: number }, number> = {
  name: 'DummyEmitter',
  gated: false,
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
  gated: false,
  run: async function* ({ n }, upstream, log) {
    if (upstream == null) throw new Error('Head needs an upstream stream');
    let count = 0;
    for await (const value of upstream as Stream<number>) {
      log(`${this.name}: consume ${value}`);
      yield value as number;
      count++;
      if (count >= n) {
        await (upstream as Stream<number>).return(undefined);
        return;
      }
    }
  },
};

// The destructive leaf's buffering-vs-streaming choice is made INSIDE run, based on `gated` —
// which is set per-invocation, not fixed on the leaf definition. That's the property we're
// actually trying to prove wires through correctly.
const destructiveLeaf: Leaf<Record<string, never>, string> = {
  name: 'DummyDelete',
  gated: true,
  run: async function* (_input, upstream, log) {
    if (upstream == null) throw new Error('DummyDelete needs an upstream stream');
    const source = upstream as Stream<string>;

    if (!this.gated) {
      for await (const value of source) {
        log(`${this.name}: act (streamed, pre-approved) on ${value}`);
        yield value;
      }
      return;
    }

    const buffered: string[] = [];
    for await (const value of source) buffered.push(value);
    log(`${this.name}: GATE approve on ${JSON.stringify(buffered)}? (simulated: yes)`);
    for (const value of buffered) {
      log(`${this.name}: act (buffered, post-approval) on ${value}`);
      yield value;
    }
  },
};

// --- Minimal "engine": run a two-leaf pipe, A | B. Just enough to see what a real one needs. ---
async function runPipe<A, B>(a: { leaf: Leaf<A, unknown>; input: A }, b: { leaf: Leaf<unknown, B>; input: unknown }, log: (msg: string) => void): Promise<B[]> {
  const upstream = a.leaf.run(a.input, undefined, log) as Stream<unknown>;
  const out: B[] = [];
  for await (const value of b.leaf.run(b.input, upstream, log)) {
    out.push(value);
  }
  return out;
}

async function main() {
  console.log('=== Orchestrate: DummyEmitter | Head(3), through the leaf/engine shape ===');
  {
    const log = (msg: string) => console.log(msg);
    const result = await runPipe({ leaf: emitterLeaf, input: { from: 1 } }, { leaf: headLeaf as Leaf<unknown, number>, input: { n: 3 } }, log);
    console.log('result:', result);
  }

  console.log('\n=== Orchestrate: dummy source | DummyDelete, gated=true (per-run) ===');
  {
    const log = (msg: string) => console.log(msg);
    async function* names(): Stream<string> {
      yield 'a.txt';
      yield 'b.txt';
      yield 'c.txt';
    }
    const namesLeaf: Leaf<Record<string, never>, string> = { name: 'Names', gated: false, run: () => names() };
    const gatedDelete: Leaf<Record<string, never>, string> = { ...destructiveLeaf, gated: true };
    const result = await runPipe({ leaf: namesLeaf, input: {} }, { leaf: gatedDelete as Leaf<unknown, string>, input: {} }, log);
    console.log('result:', result);
  }

  console.log('\n=== Orchestrate: dummy source | DummyDelete, gated=false (pre-approved, same run) ===');
  {
    const log = (msg: string) => console.log(msg);
    async function* names(): Stream<string> {
      yield 'a.txt';
      yield 'b.txt';
      yield 'c.txt';
    }
    const namesLeaf: Leaf<Record<string, never>, string> = { name: 'Names', gated: false, run: () => names() };
    const ungatedDelete: Leaf<Record<string, never>, string> = { ...destructiveLeaf, gated: false };
    const result = await runPipe({ leaf: namesLeaf, input: {} }, { leaf: ungatedDelete as Leaf<unknown, string>, input: {} }, log);
    console.log('result:', result);
  }
}

main();
