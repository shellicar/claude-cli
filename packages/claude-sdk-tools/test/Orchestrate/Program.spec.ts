import { channel } from '@shellicar/orchestrate-core';
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
  ended: unknown;
  executor: FakeExecutor;
};

async function ran(input: Record<string, unknown>, response: FakeResponse = { exitCode: 0 }, upstream?: string): Promise<Ran> {
  const executor = new FakeExecutor(() => response);
  const tool = createProgramTool(executor, new MemoryFileSystem(), fakeEnvProvider({}));
  const out = channel(64 * 1024);
  const said: string[] = [];
  const captured: string[] = [];
  const from = upstream == null ? undefined : readerOver(Buffer.from(upstream, 'utf8'));

  const running = tool.run({ cwd: '/', ...input }, from, out, (line, options) => void (options?.captured === true ? captured : said).push(line), () => {});

  const chunks: Buffer[] = [];
  for (let chunk = await out.read(); chunk != null; chunk = await out.read()) {
    chunks.push(chunk);
  }
  await running.stop();
  return { output: Buffer.concat(chunks).toString('utf8'), said, captured, ended: running.ended(), executor };
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
    const { output } = await ran({ program: 'echo', args: ['hello'] }, { stdout: 'hello\n', exitCode: 0 });

    const expected = 'hello\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('goes down unchanged when it is not text', async () => {
    const bytes = '\u0000\u00ff\u0080';
    const { output } = await ran({ program: 'cat' }, { stdout: bytes, exitCode: 0 });

    const expected = Buffer.from(bytes, 'binary').toString('hex');
    const actual = Buffer.from(output, 'binary').toString('hex');
    expect(actual).toBe(expected);
  });

  it('goes down whole when it has no separator in it', async () => {
    const { output } = await ran({ program: 'head' }, { stdout: 'no separator at all', exitCode: 0 });

    const expected = 'no separator at all';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

describe('what a process writes to its stderr', () => {
  it('is captured rather than said, so it is shown only when it is worth reading', async () => {
    const { captured, said } = await ran({ program: 'curl' }, { stderr: 'downloading: 10%\n', exitCode: 0 });

    const expected = { captured: ['downloading: 10%'], said: [] };
    const actual = { captured, said };
    expect(actual).toEqual(expected);
  });

  it('does not go down with the output', async () => {
    const { output } = await ran({ program: 'curl' }, { stdout: 'result\n', stderr: 'noise\n', exitCode: 0 });

    const expected = 'result\n';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

describe('how a process ended', () => {
  it('is finished when it exited zero', async () => {
    const { ended } = await ran({ program: 'true' }, { exitCode: 0 });

    const expected = { kind: 'finished' };
    const actual = ended;
    expect(actual).toEqual(expected);
  });

  it('is a failure carrying the exit code when it exited non-zero', async () => {
    const { ended } = await ran({ program: 'false' }, { exitCode: 3 });

    const expected = { kind: 'failed', code: 3 };
    const actual = ended;
    expect(actual).toEqual(expected);
  });

  it('is the signal it died of when a signal killed it', async () => {
    const { ended } = await ran({ program: 'sleep' }, { exitCode: null, signal: 'SIGKILL' });

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
    const executor = new FakeExecutor((_cmd, stdin) => ({ stdout: stdin, exitCode: 0 }));
    const tool = createProgramTool(executor, new MemoryFileSystem(), fakeEnvProvider({}));
    const out = channel(64 * 1024);

    const running = tool.run({ program: 'cat', cwd: '/' }, readerOver(Buffer.from('piped in\n')), out, () => {}, () => {});
    const chunks: Buffer[] = [];
    for (let chunk = await out.read(); chunk != null; chunk = await out.read()) {
      chunks.push(chunk);
    }
    await running.stop();

    const expected = 'piped in\n';
    const actual = Buffer.concat(chunks).toString('utf8');
    expect(actual).toBe(expected);
  });

  it('gives it literal input when the call wrote some', async () => {
    const executor = new FakeExecutor((_cmd, stdin) => ({ stdout: stdin, exitCode: 0 }));
    const tool = createProgramTool(executor, new MemoryFileSystem(), fakeEnvProvider({}));
    const out = channel(64 * 1024);

    const running = tool.run({ program: 'cat', cwd: '/', stdin: 'written here' }, undefined, out, () => {}, () => {});
    const chunks: Buffer[] = [];
    for (let chunk = await out.read(); chunk != null; chunk = await out.read()) {
      chunks.push(chunk);
    }
    await running.stop();

    const expected = 'written here';
    const actual = Buffer.concat(chunks).toString('utf8');
    expect(actual).toBe(expected);
  });
});

// A spawned process writes to a pipe, so a well-behaved one already writes plain. What arrives with
// escape codes in it came from a program told to colour anyway, and stripping is the common want:
// the exception is being shown what a command really emits.
describe('escape codes in what a process wrote', () => {
  it('are stripped, so what goes down is what the text says', async () => {
    const { output } = await ran({ program: 'git', args: ['diff'] }, { stdout: '\u001b[31mdeleted\u001b[0m\n', exitCode: 0 });

    const expected = 'deleted\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('are kept when the call said to keep them', async () => {
    const { output } = await ran({ program: 'git', args: ['diff', '--color'], stripAnsi: false }, { stdout: '\u001b[31mdeleted\u001b[0m\n', exitCode: 0 });

    const expected = '\u001b[31mdeleted\u001b[0m\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('are stripped from what it captured too', async () => {
    const { captured } = await ran({ program: 'git' }, { stderr: '\u001b[33mwarning\u001b[0m\n', exitCode: 1 });

    const expected = ['warning'];
    const actual = captured;
    expect(actual).toEqual(expected);
  });
});

// `command > file` is how a command's output becomes a file rather than something to read, and it
// is why a call that redirects counts as writing as far as a decision is concerned.
describe('a command told to write its output to a file', () => {
  it('writes the file', async () => {
    const fs = new MemoryFileSystem();
    const tool = createProgramTool(new FakeExecutor(() => ({ stdout: 'result\n', exitCode: 0 })), fs, fakeEnvProvider({}));
    const out = channel(64 * 1024);

    const running = tool.run({ program: 'echo', cwd: '/', redirect: { stdout: '/out.txt' } }, undefined, out, () => {}, () => {});
    for (let chunk = await out.read(); chunk != null; chunk = await out.read()) {
      // drain
    }
    await running.stop();

    const expected = 'result\n';
    const actual = await fs.readFile('/out.txt');
    expect(actual).toBe(expected);
  });

  it('sends nothing down, the way a redirected command shows nothing on a terminal', async () => {
    const fs = new MemoryFileSystem();
    const tool = createProgramTool(new FakeExecutor(() => ({ stdout: 'result\n', exitCode: 0 })), fs, fakeEnvProvider({}));
    const out = channel(64 * 1024);

    const running = tool.run({ program: 'echo', cwd: '/', redirect: { stdout: '/out.txt' } }, undefined, out, () => {}, () => {});
    const chunks: Buffer[] = [];
    for (let chunk = await out.read(); chunk != null; chunk = await out.read()) {
      chunks.push(chunk);
    }
    await running.stop();

    const expected = '';
    const actual = Buffer.concat(chunks).toString('utf8');
    expect(actual).toBe(expected);
  });

  it('says how it ended as it would have anyway', async () => {
    const fs = new MemoryFileSystem();
    const tool = createProgramTool(new FakeExecutor(() => ({ stdout: 'x', exitCode: 4 })), fs, fakeEnvProvider({}));
    const out = channel(64 * 1024);

    const running = tool.run({ program: 'echo', cwd: '/', redirect: { stdout: '/out.txt' } }, undefined, out, () => {}, () => {});
    for (let chunk = await out.read(); chunk != null; chunk = await out.read()) {
      // drain
    }
    await running.stop();

    const expected = { kind: 'failed', code: 4 };
    const actual = running.ended();
    expect(actual).toEqual(expected);
  });
});

// A run has a limit covering the whole pipeline; a command may have its own, for the one step known
// to be slow.
describe('a command that outlives its own limit', () => {
  it('is killed', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const tool = createProgramTool(executor, new MemoryFileSystem(), fakeEnvProvider({}), { sleep: async () => {} });
    const out = channel(64 * 1024);

    const running = tool.run({ program: 'sleep', args: ['600'], cwd: '/', timeout: 5000 }, undefined, out, () => {}, () => {});
    for (let chunk = await out.read(); chunk != null; chunk = await out.read()) {
      // drain
    }
    await running.stop();

    const expected = true;
    const actual = executor.aborted;
    expect(actual).toBe(expected);
  });

  it('says so', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: null, signal: 'SIGKILL' }));
    const tool = createProgramTool(executor, new MemoryFileSystem(), fakeEnvProvider({}), { sleep: async () => {} });
    const out = channel(64 * 1024);

    const running = tool.run({ program: 'sleep', args: ['600'], cwd: '/', timeout: 5000 }, undefined, out, () => {}, () => {});
    for (let chunk = await out.read(); chunk != null; chunk = await out.read()) {
      // drain
    }
    await running.stop();

    const expected = true;
    const actual = running.ended().kind !== 'finished';
    expect(actual).toBe(expected);
  });
});

describe('a reader that stops', () => {
  it('kills the process rather than letting it run on', async () => {
    const executor = new FakeExecutor(() => ({ stdout: 'one\ntwo\n', exitCode: 0 }));
    const tool = createProgramTool(executor, new MemoryFileSystem(), fakeEnvProvider({}));
    const out = channel(64 * 1024);

    const running = tool.run({ program: 'yes', cwd: '/' }, undefined, out, () => {}, () => {});
    out.close();
    await running.stop();

    const expected = true;
    const actual = executor.aborted;
    expect(actual).toBe(expected);
  });
});
