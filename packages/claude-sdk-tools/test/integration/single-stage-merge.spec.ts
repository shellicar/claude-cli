import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ExecV3, ExecV3InputSchema } from '../../src/entry/ExecV3';

// A one-command pipeline that merges stderr never comes back.
//
// resolveStageSinks now builds a stderr capture for every stage, including a merged one, so
// the executor has somewhere to put the diagnostics it writes itself. Executor.runPipeline's
// single-stage path forwards `mergeStderr ? stage.stdout : stage.stderr` to run(), so on a
// merged stage that capture is never handed over, never ended, and the fromStream() awaiting
// it never resolves. The stage's own status resolves; the Promise.all around it does not.
//
// A pipe of two or more is unaffected: its stages settle through finish(), which closes both
// sinks. The single-stage path is the only one that drops one.
//
// This is the shape the tool's own description advertises for capturing a build log, and the
// shape of any `2>&1` command in a && chain, since each link is its own one-stage pipeline.

const BOUND_MS = 2000;
const HUNG = 'hung';

async function settles(input: z.input<typeof ExecV3InputSchema>): Promise<string> {
  const guard = new Promise<string>((resolve) => {
    setTimeout(() => resolve(HUNG), BOUND_MS).unref();
  });
  // Either settlement proves it came back; only a hang can fail this.
  const call = ExecV3.handler(ExecV3InputSchema.parse(input)).then(
    () => 'settled',
    () => 'settled',
  );
  return Promise.race([call, guard]);
}

describe('a single command that merges stderr into stdout', () => {
  it('comes back when its output is captured', async () => {
    const expected = 'settled';
    const actual = await settles({
      intent: 'run one command with its stderr merged into stdout',
      commands: [{ program: 'echo', args: ['hi'], redirect: { stderr: '&1' } }],
    });
    expect(actual).toBe(expected);
  });

  it('comes back when its stdout is redirected to a file', async () => {
    const expected = 'settled';
    const actual = await settles({
      intent: 'run one command with stdout to a file and stderr merged into it',
      commands: [{ program: 'echo', args: ['hi'], redirect: { stdout: '/tmp/single-stage-merge.log', stderr: '&1' } }],
    });
    expect(actual).toBe(expected);
  });
});
