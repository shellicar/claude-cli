// Scratch POC, step 9 — &&/||/; operators between stages. Surfaced a real bug while building
// this: every prior POC unconditionally passed the previous stage's drained stdout as the next
// stage's upstream, as if every join were a pipe. That's wrong — in real bash, only `|` pipes
// stdout into the next command's stdin; `;`/`&&`/`||` just sequence, no data flows between them.
// `git fetch -p && git rebase origin/main` must NOT hand rebase fetch's stdout as stdin.

import { makeProgramLeaf } from './orchestrate-program-leaf.ts';
import type { Leaf, Stream } from './orchestrate-program-leaf.ts';

type Op = '|' | '&&' | '||'; // forward-pointing, same convention as ExecV3. Absent = sequential (';').

type Stage = { leaf: Leaf<unknown, unknown>; input: unknown; op?: Op };

async function* asAsyncIterable<T>(values: T[]): Stream<T> {
  for (const v of values) yield v;
}

type Report = { name: string; ran: boolean; success: boolean | null };

async function execute(stages: Stage[]): Promise<{ result: unknown[]; report: Report[] }> {
  const report: Report[] = [];
  let upstream: Stream<unknown> | AsyncIterable<unknown> | undefined;
  let lastSuccess: boolean | null = null;
  let lastOp: Op | undefined;

  for (const stage of stages) {
    // Whether this stage runs at all depends on the OP that preceded it and the prior result.
    const shouldRun = lastOp == null ? true : lastOp === '&&' ? lastSuccess === true : lastOp === '||' ? lastSuccess === false : true; // '|' always runs (it's a pipe continuation)

    if (!shouldRun) {
      report.push({ name: stage.leaf.name, ran: false, success: null });
      lastOp = stage.op;
      continue;
    }

    // Only a real `|` join forwards the previous stage's stdout as this stage's stdin.
    // Every other join (';'/'&&'/'||') starts this stage with no upstream at all.
    const sourceForRun = lastOp === '|' ? upstream : undefined;

    const stderr: string[] = [];
    const leafResult = stage.leaf.run(stage.input, sourceForRun, stderr);
    const drained: unknown[] = [];
    for await (const value of leafResult.stdout) drained.push(value);
    upstream = asAsyncIterable(drained);

    const success = leafResult.success();
    report.push({ name: stage.leaf.name, ran: true, success });
    lastSuccess = success;
    lastOp = stage.op;

    if (stage.op == null && stages.indexOf(stage) === stages.length - 1) break; // last stage
  }

  const out: unknown[] = [];
  if (upstream != null) for await (const value of upstream) out.push(value);
  return { result: out, report };
}

function sh(cmd: string, op?: Op): Stage {
  return { leaf: makeProgramLeaf({ program: 'sh', args: ['-c', cmd], cwd: process.cwd() }) as Leaf<unknown, unknown>, input: {}, op };
}

async function main() {
  console.log('=== A: true && should-run — matches fetch && rebase, both real commands ===');
  {
    const { report } = await execute([sh('exit 0', '&&'), sh('echo ran')]);
    console.log(report);
    console.log(report[1].ran ? 'PASS: second stage ran because the first succeeded' : 'FAIL');
  }

  console.log('\n=== B: false && should-NOT-run ===');
  {
    const { report } = await execute([sh('exit 1', '&&'), sh('echo should-not-appear')]);
    console.log(report);
    console.log(!report[1].ran ? 'PASS: second stage correctly skipped' : 'FAIL: ran despite the first failing');
  }

  console.log('\n=== C: false || should-run (fallback) ===');
  {
    const { report } = await execute([sh('exit 1', '||'), sh('echo fallback ran')]);
    console.log(report);
    console.log(report[1].ran ? 'PASS: fallback ran because the first failed' : 'FAIL');
  }

  console.log("\n=== D: the actual bug — ';' must NOT pipe stdout into the next stage's stdin ===");
  {
    const { result } = await execute([sh('echo upstream-data'), sh('cat')]); // sequential, no op
    console.log('result:', result);
    console.log(result.length === 0 ? "PASS: 'cat' got no stdin, correctly received nothing" : `FAIL: 'cat' received piped data it should never have gotten: ${JSON.stringify(result)}`);
  }

  console.log("\n=== E: '|' DOES pipe stdout into the next stage's stdin, for comparison ===");
  {
    const { result } = await execute([sh('echo upstream-data', '|'), sh('cat')]);
    console.log('result:', result);
    console.log(result[0] === 'upstream-data' ? "PASS: '|' correctly piped the data through" : 'FAIL');
  }
}

main();
