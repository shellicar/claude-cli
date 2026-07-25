import type { Stream } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createProgramLeaf, ProgramFailsafeTerminated } from '../../src/Orchestrate/leaves/Program.js';
import { FakeExecutor } from '../FakeExecutor.js';

async function drain(stream: Stream<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of stream) {
    out.push(value);
  }
  return out;
}

describe('Program leaf — stdout/stderr separation', () => {
  it('yields stdout lines on the stream', async () => {
    const executor = new FakeExecutor(() => ({ stdout: 'out-line\n', exitCode: 0 }));
    const leaf = createProgramLeaf(executor);

    const { stdout } = leaf.run({ program: 'sh', cwd: '/tmp' }, undefined, []);
    const actual = await drain(stdout);

    const expected = ['out-line'];
    expect(actual).toEqual(expected);
  });

  it('captures stderr separately from stdout by default', async () => {
    const executor = new FakeExecutor(() => ({ stdout: 'out-line\n', stderr: 'err-line\n', exitCode: 0 }));
    const leaf = createProgramLeaf(executor);
    const stderr: string[] = [];

    const { stdout } = leaf.run({ program: 'sh', cwd: '/tmp' }, undefined, stderr);
    await drain(stdout);

    const expected = ['err-line'];
    const actual = stderr;
    expect(actual).toEqual(expected);
  });

  it('folds stderr into stdout when mergeStderr is set', async () => {
    const executor = new FakeExecutor(() => ({ stdout: 'out-line\n', stderr: 'err-line\n', exitCode: 0 }));
    const leaf = createProgramLeaf(executor);
    const stderr: string[] = [];

    const { stdout } = leaf.run({ program: 'sh', cwd: '/tmp', mergeStderr: true }, undefined, stderr);
    await drain(stdout);

    const expected: string[] = [];
    const actual = stderr;
    expect(actual).toEqual(expected);
  });
});

describe('Program leaf — success', () => {
  it('reports success when the exit code is 0', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const leaf = createProgramLeaf(executor);

    const { stdout, success } = leaf.run({ program: 'sh', cwd: '/tmp' }, undefined, []);
    await drain(stdout);

    const expected = true;
    const actual = success();
    expect(actual).toBe(expected);
  });

  it('reports failure when the exit code is non-zero', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 1 }));
    const leaf = createProgramLeaf(executor);

    const { stdout, success } = leaf.run({ program: 'sh', cwd: '/tmp' }, undefined, []);
    await drain(stdout);

    const expected = false;
    const actual = success();
    expect(actual).toBe(expected);
  });
});

describe('Program leaf — command wiring', () => {
  it('passes program, args, cwd, and env to the executor', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const leaf = createProgramLeaf(executor);

    const { stdout } = leaf.run({ program: 'echo', args: ['hi'], cwd: '/somewhere', env: { FOO: 'bar' } }, undefined, []);
    await drain(stdout);

    const expected = { program: 'echo', args: ['hi'], cwd: '/somewhere', env: { FOO: 'bar' } };
    const actual = executor.calls[0];
    expect(actual).toEqual(expected);
  });

  it('pipes an upstream string iterable into the process stdin', async () => {
    let capturedStdin = '';
    const executor = new FakeExecutor((_cmd, stdin) => {
      capturedStdin = stdin;
      return { exitCode: 0 };
    });
    const leaf = createProgramLeaf(executor);

    async function* upstream(): Stream<string> {
      yield 'piped-value';
    }

    const { stdout } = leaf.run({ program: 'cat', cwd: '/tmp' }, upstream(), []);
    await drain(stdout);

    const expected = 'piped-value\n';
    const actual = capturedStdin;
    expect(actual).toBe(expected);
  });
});

describe('Program leaf — failsafe cap', () => {
  it('hard-terminates a producer that exceeds the line cap', async () => {
    const hugeOutput = `${Array.from({ length: 10_001 }, (_, i) => `line${i}`).join('\n')}\n`;
    const executor = new FakeExecutor(() => ({ stdout: hugeOutput, exitCode: 0 }));
    const leaf = createProgramLeaf(executor);

    const { stdout } = leaf.run({ program: 'yes', cwd: '/tmp' }, undefined, []);

    await expect(drain(stdout)).rejects.toThrow(ProgramFailsafeTerminated);
  });
});
