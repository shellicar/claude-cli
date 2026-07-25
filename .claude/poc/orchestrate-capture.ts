// Scratch POC, step 8 — capture + reference. A stage's stdout can be held as a named value;
// a later stage's args reference it by name and it gets resolved by the engine, just before
// that stage runs — never shown to the caller. This is the actual az-key -> curl mechanism
// that started this whole design conversation, now built for real against real processes.

import { makeProgramLeaf } from './orchestrate-program-leaf.ts';
import type { Leaf, Stream } from './orchestrate-program-leaf.ts';

type Captures = Map<string, string>;

// A stage is built lazily, given whatever's been captured so far — this is what lets a later
// stage's args reference an earlier stage's captured output, resolved just-in-time.
type StageBuilder = {
  captureAs?: string;
  build: (captures: Captures) => { leaf: Leaf<unknown, unknown>; input: unknown; templateForLog: string };
};

async function* asAsyncIterable<T>(values: T[]): Stream<T> {
  for (const v of values) yield v;
}

async function execute(stages: StageBuilder[]): Promise<{ result: unknown[]; log: string[] }> {
  const captures: Captures = new Map();
  const log: string[] = [];
  let upstream: Stream<unknown> | AsyncIterable<unknown> | undefined;

  for (const stage of stages) {
    const { leaf, input, templateForLog } = stage.build(captures);
    // The log/review only ever sees the unresolved template — never the value a reference
    // expanded to. That's the whole point: approval is on the shape, not the secret bytes.
    log.push(`RUN ${leaf.name}: ${templateForLog}`);

    const stderr: string[] = [];
    const leafResult = leaf.run(input, upstream, stderr);
    const drained: unknown[] = [];
    for await (const value of leafResult.stdout) drained.push(value);
    upstream = asAsyncIterable(drained);

    const success = leafResult.success();
    log.push(`  -> success=${success} stderr=${JSON.stringify(stderr)}`);
    if (!success) break;

    if (stage.captureAs) {
      captures.set(stage.captureAs, drained.join('\n'));
      log.push(`  -> captured as $${stage.captureAs} (value not shown here either)`);
    }
  }

  const out: unknown[] = [];
  if (upstream != null) for await (const value of upstream) out.push(value);
  return { result: out, log };
}

// Resolves $NAME references in an args array only — never in program/cwd, matching the design
// doc: a reference can only affect data flowing into a computation, never where an effect lands.
function resolveArgs(args: string[], captures: Captures): string[] {
  return args.map((arg) => arg.replace(/\$(\w+)/g, (match, name) => captures.get(name) ?? match));
}

function programStage(opts: { program: string; args: string[]; captureAs?: string }): StageBuilder {
  return {
    captureAs: opts.captureAs,
    build: (captures) => ({
      leaf: makeProgramLeaf({ program: opts.program, args: resolveArgs(opts.args, captures), cwd: process.cwd() }) as Leaf<unknown, unknown>,
      input: {},
      templateForLog: `${opts.program} ${JSON.stringify(opts.args)}`, // unresolved — the template, not the resolved value
    }),
  };
}

async function main() {
  console.log('=== az-key -> curl, for real: capture a value, reference it in a later stage ===\n');

  const stages: StageBuilder[] = [
    // Stands in for `az account get-access-token` — generates the value at runtime, so (like a
    // real credential command) the secret is never present in the command's own template/argv,
    // only in its dynamically-produced stdout.
    programStage({ program: 'sh', args: ['-c', 'echo token-$(date +%s%N | sha256sum | cut -c1-12)'], captureAs: 'TOKEN' }),
    // References $TOKEN — resolved just before this stage runs, never logged unresolved... resolved.
    programStage({ program: 'sh', args: ['-c', 'echo "Authorization: Bearer $TOKEN"'] }),
  ];

  const { result, log } = await execute(stages);
  console.log(log.join('\n'));
  console.log('\nfinal result:', result);

  const tokenValue = result[0] as string; // 'Authorization: Bearer token-xxxxxxxxxxxx'
  const logText = log.join('\n');
  console.log(logText.includes(tokenValue.replace('Authorization: Bearer ', '')) ? 'FAIL: the raw captured value leaked into the log' : 'PASS: log never shows the resolved value, only the $TOKEN template');
  console.log(tokenValue.startsWith('Authorization: Bearer token-') ? 'PASS: the second stage actually received the real resolved value' : 'FAIL: resolution did not happen correctly');
}

main();
