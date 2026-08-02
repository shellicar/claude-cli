import { Executor } from '@shellicar/exec-core';
import { execute, type Stage } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createProgramToolV2 } from '../../src/Orchestrate/tools/Program.js';
import { nodeFs } from '../../src/fs/nodeFs.js';

// Real processes, because the behaviour only exists when there is one: a producer that has to be
// signalled and reaped, a buffer that has to make it wait, and output that has to be bounded before
// it is held. Every equivalent test in the default tier hands itself the answer through a fake, and
// each of the cases below has broken at least once behind a green suite.

const env = { buildEnv: () => process.env, get: (name: string) => process.env[name] } as never;
const tool = createProgramToolV2(new Executor(), nodeFs, env);

function stage(program: string, args: string[], op?: '|'): Stage {
  return { kind: 'tool', tool: tool as never, input: { program, args, cwd: process.cwd() }, op };
}

/** A run that cannot stall the suite: a hang surfaces as a value no assertion can match. */
async function run(stages: Stage[], ms = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timed out')), ms);
  try {
    return await execute(stages, { env, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

describe('a consumer that stops early', () => {
  it('returns what the consumer asked for', async () => {
    const { result } = await run([stage('seq', ['1', '1000000'], '|'), stage('head', ['-3'])]);

    const expected = ['1', '2', '3'];
    const actual = result;
    expect(actual).toEqual(expected);
  });

  it('kills the producer with SIGPIPE', async () => {
    const { reports } = await run([stage('seq', ['1', '1000000'], '|'), stage('head', ['-3'])]);

    const expected = 'SIGPIPE';
    const actual = reports[0]?.signal;
    expect(actual).toBe(expected);
  });

  it('reports what the producer got out before it was stopped', async () => {
    const { reports } = await run([stage('seq', ['1', '1000000'], '|'), stage('head', ['-3'])]);

    const emitted = reports[0]?.emitted ?? 0;
    const expected = true;
    const actual = emitted > 0 && emitted < 1_000_000;
    expect(actual).toBe(expected);
  });

  it('stops the producer rather than draining it', async () => {
    const { reports } = await run([stage('yes', [], '|'), stage('head', ['-1'])]);

    const expected = 'SIGPIPE';
    const actual = reports[0]?.signal;
    expect(actual).toBe(expected);
  });

  it('reaches a producer two stages back', async () => {
    const { reports } = await run([stage('yes', [], '|'), stage('cat', [], '|'), stage('head', ['-1'])]);

    const expected = ['SIGPIPE', 'SIGPIPE'];
    const actual = [reports[0]?.signal, reports[1]?.signal];
    expect(actual).toEqual(expected);
  });
});

describe('a producer with no end', () => {
  it('terminates when nothing downstream stops it', async () => {
    const { result } = await run([stage('yes', [])]);

    const expected = true;
    const actual = result.length > 0;
    expect(actual).toBe(expected);
  });

  it('says what came back is only the start of its output', async () => {
    const { reports } = await run([stage('yes', [])]);

    const expected = true;
    const actual = (reports[0]?.message ?? '').includes('start of its output');
    expect(actual).toBe(expected);
  });
});

describe('output with no line separator in it', () => {
  it('is bounded rather than held whole', async () => {
    const { result } = await run([stage('head', ['-c', '20000000', '/dev/zero'])]);

    const expected = true;
    const actual = result.length > 1 && result.every((value) => String(value).length <= 1024 * 1024);
    expect(actual).toBe(expected);
  });

  it('does not take longer than assembling it once would', async () => {
    const started = Date.now();
    await run([stage('head', ['-c', '20000000', '/dev/zero'])]);

    const expected = true;
    const actual = Date.now() - started < 10_000;
    expect(actual).toBe(expected);
  });
});
