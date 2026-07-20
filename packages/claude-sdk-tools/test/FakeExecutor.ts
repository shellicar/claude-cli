import type { CommandSpec, ExitStatus, IExecutor, SpawnOpts } from '@shellicar/exec-core';

export type FakeResponse = {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
};

/** Computes the canned response for one call, given the command and whatever was piped to its
 *  stdin (already drained to a string — no real process, so nothing else can read it). */
export type FakeResponder = (cmd: CommandSpec, stdin: string) => FakeResponse;

async function drain(stdin: SpawnOpts['stdin']): Promise<string> {
  if (!stdin) {
    return '';
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** A test double for IExecutor — never spawns a real process. `respond` computes the outcome
 *  from the command and its (in-memory, drained) stdin; every call is recorded for assertions
 *  on what would have run. */
export class FakeExecutor implements IExecutor {
  public readonly calls: CommandSpec[] = [];

  constructor(private readonly respond: FakeResponder = () => ({ exitCode: 0 })) {}

  public async run(cmd: CommandSpec, opts: SpawnOpts = {}): Promise<ExitStatus> {
    this.calls.push(cmd);
    const stdin = await drain(opts.stdin);
    const response = this.respond(cmd, stdin);

    if (response.stdout != null) {
      opts.stdout?.write(response.stdout);
    }
    if (response.stderr != null) {
      opts.stderr?.write(response.stderr);
    }
    opts.stdout?.end();
    opts.stderr?.end();

    return { exitCode: 'exitCode' in response ? (response.exitCode ?? null) : 0, signal: response.signal ?? null };
  }
}

/** A FakeResponder covering the shell-ish invocations these test suites lean on:
 *  - `echo <args...>` -> stdout of the args, space-joined, newline-terminated
 *  - `sh`/`bash -c '<script>'` -> a tiny subset: `exit N`, `echo X`, `echo X >&2`, `;`-joined
 *  - `cat` (no args) -> echoes stdin back
 *  - `grep <pattern>` -> filters stdin lines containing pattern
 *  - `node -e '<code>'` -> a tiny subset: `process.stdout.write(...)` with a literal string,
 *    `process.cwd()`, or `process.env.NAME`
 *  Anything else falls through to the given `fallback` (default: exit 0, no output). Each
 *  interpreted case exists only because an existing test needs that exact shape — this is not
 *  a shell, it recognises a handful of literal patterns and nothing more. */
export function shellLikeResponder(fallback: FakeResponder = () => ({ exitCode: 0 })): FakeResponder {
  return (cmd, stdin) => {
    if (cmd.cwd.includes('nonexistent')) {
      return { stderr: `Working directory not found: ${cmd.cwd}`, exitCode: 126 };
    }
    if (cmd.program.startsWith('definitely-not-a-real-command')) {
      return { stderr: `Command not found: ${cmd.program}`, exitCode: 127 };
    }
    if (cmd.program === 'echo') {
      return { stdout: `${(cmd.args ?? []).join(' ')}\n` };
    }
    if (cmd.program === 'false') {
      return { exitCode: 1 };
    }
    if ((cmd.program === 'sh' || cmd.program === 'bash') && cmd.args?.[0] === '-c') {
      return runScript(cmd.args[1] ?? '');
    }
    if (cmd.program === 'cat' && (cmd.args ?? []).length === 0) {
      return { stdout: stdin };
    }
    if (cmd.program === 'grep') {
      const pattern = cmd.args?.[0] ?? '';
      const matched = stdin
        .split('\n')
        .filter((line) => line.includes(pattern))
        .join('\n');
      return { stdout: matched.length > 0 ? `${matched}\n` : '', exitCode: matched.length > 0 ? 0 : 1 };
    }
    if (cmd.program === 'printf') {
      return { stdout: (cmd.args ?? []).join('') };
    }
    if (cmd.program === 'wc' && cmd.args?.[0] === '-l') {
      const count = (stdin.match(/\n/g) ?? []).length;
      return { stdout: `${count}\n` };
    }
    if (cmd.program === 'tee') {
      return { stdout: stdin };
    }
    if (cmd.program === 'node' && cmd.args?.[0] === '-e') {
      return runNodeDashE(cmd.args[1] ?? '', cmd);
    }
    return fallback(cmd, stdin);
  };
}

function runScript(script: string): FakeResponse {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  for (const rawStatement of script.split(';')) {
    const statement = rawStatement.trim();
    const exitMatch = statement.match(/^exit (\d+)$/);
    if (exitMatch) {
      exitCode = Number(exitMatch[1]);
      continue;
    }
    const echoErrMatch = statement.match(/^echo (.+) >&2$/);
    if (echoErrMatch) {
      stderr += `${echoErrMatch[1]}\n`;
      continue;
    }
    const echoMatch = statement.match(/^echo (.+)$/);
    if (echoMatch) {
      stdout += `${echoMatch[1]}\n`;
    }
  }
  return { stdout, stderr, exitCode };
}

function runNodeDashE(code: string, cmd: CommandSpec): FakeResponse {
  if (code.includes('process.cwd()')) {
    return { stdout: cmd.cwd };
  }
  const envMatch = code.match(/process\.env\.(\w+)/) ?? code.match(/process\.env\[['"](\w+)['"]\]/);
  if (envMatch) {
    return { stdout: cmd.env[envMatch[1]] ?? 'missing' };
  }
  const ansiMatch = code.match(/process\.stdout\.write\('(.+)'\)/);
  if (ansiMatch) {
    return { stdout: ansiMatch[1].replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16))) };
  }
  return { exitCode: 0 };
}
