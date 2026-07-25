// Scratch POC — not part of any package. Proves two mechanics before defineToolV2 exists:
// 1. An unbounded async-generator producer can be short-circuited by a downstream consumer
//    that only takes N (the `yes | head -1` property, for a ToolCall leaf instead of a process).
// 2. A "destructive" consumer can run in two modes — buffered (collect fully, then act) vs
//    streamed (act as items arrive) — selected by a flag standing in for "was this pre-approved".

type Stream<T> = AsyncGenerator<T, void, unknown>;

// --- Dummy producer: emits values 1..∞, logging each one as "produced" so we can see how far
// it actually got pulled before something downstream stopped asking. ---
async function* dummyEmitter(log: (msg: string) => void): Stream<number> {
  let i = 1;
  try {
    while (true) {
      log(`produce ${i}`);
      yield i;
      i++;
    }
  } finally {
    // Runs when the consumer stops pulling (return()/break) — proves the producer actually
    // notices early termination, the same way `yes` dying to SIGPIPE proves a real OS pipe short-circuits.
    log('producer: cleaned up (stopped being pulled)');
  }
}

// --- Dummy unbuffered consumer: Head-shaped. Takes N items and stops. ---
async function head<T>(source: Stream<T>, n: number, log: (msg: string) => void): Promise<T[]> {
  const taken: T[] = [];
  for await (const value of source) {
    log(`consume ${value}`);
    taken.push(value);
    if (taken.length >= n) {
      await source.return(undefined); // signal upstream to stop — the short-circuit
      break;
    }
  }
  return taken;
}

// --- Dummy "destructive" consumer: DeleteFile-shaped. Two modes. ---
async function destructiveConsumer<T>(source: Stream<T>, preApproved: boolean, log: (msg: string) => void): Promise<{ acted: T[] }> {
  if (preApproved) {
    // Ungated: no gate needs a resolved value to show, so it can stream straight through.
    const acted: T[] = [];
    for await (const value of source) {
      log(`act (streamed, pre-approved) on ${value}`);
      acted.push(value);
    }
    return { acted };
  }

  // Gated: must buffer fully before it has something resolved to present for approval.
  const buffered: T[] = [];
  for await (const value of source) {
    buffered.push(value);
  }
  log(`GATE: approve destructive action on ${JSON.stringify(buffered)}? (simulated: yes)`);
  for (const value of buffered) {
    log(`act (buffered, post-approval) on ${value}`);
  }
  return { acted: buffered };
}

async function main() {
  console.log('=== 1. Streaming short-circuit: dummyEmitter | head(3) ===');
  {
    const events: string[] = [];
    const log = (msg: string) => events.push(msg);
    const result = await head(dummyEmitter(log), 3, log);
    console.log(events.join('\n'));
    console.log('head(3) result:', result);
    console.log(events.some((e) => e === 'producer: cleaned up (stopped being pulled)') ? 'PASS: producer stopped early, not run to completion' : 'FAIL: producer was not short-circuited');
  }

  console.log('\n=== 2a. Destructive consumer, pre-approved (ungated) ===');
  {
    const events: string[] = [];
    const log = (msg: string) => events.push(msg);
    async function* small(): Stream<string> {
      yield 'a.txt';
      yield 'b.txt';
      yield 'c.txt';
    }
    const result = await destructiveConsumer(small(), true, log);
    console.log(events.join('\n'));
    console.log('result:', result);
    console.log(!events.some((e) => e.startsWith('GATE')) ? 'PASS: no gate, streamed straight through' : 'FAIL: gate appeared despite pre-approval');
  }

  console.log('\n=== 2b. Destructive consumer, NOT pre-approved (gated) ===');
  {
    const events: string[] = [];
    const log = (msg: string) => events.push(msg);
    async function* small(): Stream<string> {
      yield 'a.txt';
      yield 'b.txt';
      yield 'c.txt';
    }
    const result = await destructiveConsumer(small(), false, log);
    console.log(events.join('\n'));
    console.log('result:', result);
    const gateIndex = events.findIndex((e) => e.startsWith('GATE'));
    const actIndex = events.findIndex((e) => e.startsWith('act'));
    console.log(gateIndex >= 0 && gateIndex < actIndex ? 'PASS: gate showed the full resolved set before any action ran' : 'FAIL: acted before gating, or no gate at all');
  }
}

main();
