import type { CommandSpec } from '@shellicar/exec-core';
import { channel, type Ended } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createProgramTool } from '../../src/Orchestrate/tools/Program.js';
import { fakeEnvProvider } from '../fakeEnvProvider.js';
import { FakeExecutor, type FakeResponse } from '../FakeExecutor.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

// The one tool with a real process behind it. Everything about that process reaches the run through
// the four ports and nowhere else: its output goes down, its stderr is captured, its exit is how
// the stage ended, and closing its output is how it is told to stop.

type Ran = {
  output: string;
  said: string[];
  captured: string[];
  ended: Ended;
  executor: FakeExecutor;
  fs: MemoryFileSystem;
};

type Given = {
  /** What the process would do. */
  response?: FakeResponse | ((cmd: CommandSpec, stdin: string) => FakeResponse);
  /** What was piped into the stage. */
  upstream?: string;
  /** The filesystem it writes any redirect to. */
  fs?: MemoryFileSystem;
  /** A delay that has already elapsed, for a command with its own limit. */
  elapsed?: boolean;
  /** Whoever is reading walks away before the process is finished. */
  readerLeaves?: boolean;
};

/** Runs one command and reports everything observable about it. */
async function ran(input: Record<string, unknown>, given: Given = {}): Promise<Ran> {
  const respond = typeof given.response === 'function' ? given.response : () => given.response ?? { exitCode: 0 };
  const executor = new FakeExecutor(respond);
  const fs = given.fs ?? new MemoryFileSystem();
  const tool = createProgramTool(executor, fs, fakeEnvProvider({}), { sleep: given.elapsed === true ? async () => {} : () => new Promise<void>(() => {}) });
  const out = channel(64 * 1024);
  const said: string[] = [];
  const captured: string[] = [];
  const from = given.upstream == null ? undefined : readerOver(Buffer.from(given.upstream, 'utf8'));

  const running = tool.run({ cwd: '/', ...input }, from, out, (line, options) => void (options?.captured === true ? captured : said).push(line), () => {});

  const chunks: Buffer[] = [];
  if (given.readerLeaves === true) {
    out.close();
  } else {
    for (let chunk = await out.read(); chunk != null; chunk = await out.read()) {
      chunks.push(chunk);
    }
  }
  await running.stop();
  return { output: Buffer.concat(chunks).toString('utf8'), said, captured, ended: running.ended(), executor, fs };
}

function readerOver(bytes: Buffer) {
  let taken = false;
  return {
    read: async () => {
      if (taken) {
        return undefined;
      }
      taken = true;
      return bytes;
    },
  };
}

describe('what a process writes', () => {
  it('goes down, exactly as the process wrote it', async () => {
    const { output } = await ran({ program: 'echo', args: ['hello'] }, { response: { stdout: 'hello\n', exitCode: 0 } });

    const expected = 'hello\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('goes down unchanged when it is not text', async () => {
    const bytes = '\u0000\u00ff\u0080';
    const { output } = await ran({ program: 'cat' }, { response: { stdout: bytes, exitCode: 0 } });

    const expected = Buffer.from(bytes, 'binary').toString('hex');
    const actual = Buffer.from(output, 'binary').toString('hex');
    expect(actual).toBe(expected);
  });

  it('goes down whole when it has no separator in it', async () => {
    const { output } = await ran({ program: 'head' }, { response: { stdout: 'no separator at all', exitCode: 0 } });

    const expected = 'no separator at all';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

describe('what a process writes to its stderr', () => {
  it('is captured rather than said, so it is shown only when it is worth reading', async () => {
    const { captured, said } = await ran({ program: 'curl' }, { response: { stderr: 'downloading: 10%\n', exitCode: 0 } });

    const expected = { captured: ['downloading: 10%'], said: [] };
    const actual = { captured, said };
    expect(actual).toEqual(expected);
  });

  it('does not go down with the output', async () => {
    const { output } = await ran({ program: 'curl' }, { response: { stdout: 'result\n', stderr: 'noise\n', exitCode: 0 } });

    const expected = 'result\n';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

describe('how a process ended', () => {
  it('is finished when it exited zero', async () => {
    const { ended } = await ran({ program: 'true' }, { response: { exitCode: 0 } });

    const expected = { kind: 'finished' };
    const actual = ended;
    expect(actual).toEqual(expected);
  });

  it('is a failure carrying the exit code when it exited non-zero', async () => {
    const { ended } = await ran({ program: 'false' }, { response: { exitCode: 3 } });

    const expected = { kind: 'failed', code: 3 };
    const actual = ended;
    expect(actual).toEqual(expected);
  });

  it('is the signal it died of when a signal killed it', async () => {
    const { ended } = await ran({ program: 'sleep' }, { response: { exitCode: null, signal: 'SIGKILL' } });

    const expected = { kind: 'signalled', signal: 'SIGKILL' };
    const actual = ended;
    expect(actual).toEqual(expected);
  });
});

describe('what the process is given', () => {
  it('runs the program with the arguments it was told to', async () => {
    const { executor } = await ran({ program: 'git', args: ['status', '--short'] });

    const expected = { program: 'git', args: ['status', '--short'] };
    const actual = { program: executor.calls[0]?.program, args: executor.calls[0]?.args };
    expect(actual).toEqual(expected);
  });

  it('runs it where it was told to', async () => {
    const { executor } = await ran({ program: 'git', cwd: '/somewhere' });

    const expected = '/somewhere';
    const actual = executor.calls[0]?.cwd;
    expect(actual).toBe(expected);
  });

  it('gives it what was piped in, as its input', async () => {
    const { output } = await ran({ program: 'cat' }, { response: (_cmd, stdin) => ({ stdout: stdin, exitCode: 0 }), upstream: 'piped in\n' });

    const expected = 'piped in\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('gives it literal input when the call wrote some', async () => {
    const { output } = await ran({ program: 'cat', stdin: 'written here' }, { response: (_cmd, stdin) => ({ stdout: stdin, exitCode: 0 }) });

    const expected = 'written here';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

// A spawned process writes to a pipe, so a well-behaved one already writes plain. What arrives with
// escape codes in it came from a program told to colour anyway, and stripping is the common want:
// the exception is being shown what a command really emits.
describe('escape codes in what a process wrote', () => {
  it('are stripped, so what goes down is what the text says', async () => {
    const { output } = await ran({ program: 'git', args: ['diff'] }, { response: { stdout: '\u001b[31mdeleted\u001b[0m\n', exitCode: 0 } });

    const expected = 'deleted\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('are kept when the call said to keep them', async () => {
    const { output } = await ran({ program: 'git', args: ['diff', '--color'], stripAnsi: false }, { response: { stdout: '\u001b[31mdeleted\u001b[0m\n', exitCode: 0 } });

    const expected = '\u001b[31mdeleted\u001b[0m\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('are stripped from what it captured too', async () => {
    const { captured } = await ran({ program: 'git' }, { response: { stderr: '\u001b[33mwarning\u001b[0m\n', exitCode: 1 } });

    const expected = ['warning'];
    const actual = captured;
    expect(actual).toEqual(expected);
  });
});

// `command > file` is how a command's output becomes a file rather than something to read, and it
// is why a call that redirects counts as writing as far as a decision is concerned.
describe('a command told to write its output to a file', () => {
  it('writes the file', async () => {
    const { fs } = await ran({ program: 'echo', redirect: { stdout: '/out.txt' } }, { response: { stdout: 'result\n', exitCode: 0 } });

    const expected = 'result\n';
    const actual = await fs.readFile('/out.txt');
    expect(actual).toBe(expected);
  });

  it('sends nothing down, the way a redirected command shows nothing on a terminal', async () => {
    const { output } = await ran({ program: 'echo', redirect: { stdout: '/out.txt' } }, { response: { stdout: 'result\n', exitCode: 0 } });

    const expected = '';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('says how it ended as it would have anyway', async () => {
    const { ended } = await ran({ program: 'echo', redirect: { stdout: '/out.txt' } }, { response: { stdout: 'x', exitCode: 4 } });

    const expected = { kind: 'failed', code: 4 };
    const actual = ended;
    expect(actual).toEqual(expected);
  });
});

// A run has a limit covering the whole pipeline; a command may have its own, for the one step known
// to be slow.
describe('a command that outlives its own limit', () => {
  it('is killed', async () => {
    const { executor } = await ran({ program: 'sleep', args: ['600'], timeout: 5000 }, { elapsed: true });

    const expected = 'SIGKILL';
    const actual = executor.killedWith;
    expect(actual).toBe(expected);
  });

  it('ends as having been signalled, not as having finished', async () => {
    const { ended } = await ran({ program: 'sleep', args: ['600'], timeout: 5000 }, { elapsed: true, response: { exitCode: null, signal: 'SIGKILL' } });

    const expected = { kind: 'signalled', signal: 'SIGKILL' };
    const actual = ended;
    expect(actual).toEqual(expected);
  });
});

// A reader walking away is what SIGPIPE means, and a relayed pipe gives a spawned process no such
// signal of its own.
describe('a reader that stops', () => {
  it('kills the process with SIGPIPE rather than letting it run on', async () => {
    const { executor } = await ran({ program: 'yes' }, { readerLeaves: true });

    const expected = 'SIGPIPE';
    const actual = executor.killedWith;
    expect(actual).toBe(expected);
  });
});
