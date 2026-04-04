import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import type { Command, StepResult } from './types';

/** Execute a single command via child_process.spawn (no shell). */
export function execCommand(cmd: Command, cwd: string, timeoutMs?: number): Promise<StepResult> {
  const resolvedCwd = cmd.cwd ?? cwd;

  if (!existsSync(resolvedCwd)) {
    return Promise.resolve({
      stdout: '',
      stderr: `Working directory not found: ${resolvedCwd}`,
      exitCode: 126,
      signal: null,
    });
  }

  return new Promise((resolve) => {
    const env = { ...process.env, ...cmd.env } satisfies NodeJS.ProcessEnv;
    const child = spawn(cmd.program, cmd.args ?? [], {
      cwd: resolvedCwd,
      env,
      stdio: 'pipe',
      timeout: timeoutMs,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => (cmd.merge_stderr ? stdout : stderr).push(chunk));

    if (cmd.stdin !== undefined) {
      child.stdin.write(cmd.stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    if (cmd.redirect) {
      const flags = cmd.redirect.append ? 'a' : 'w';
      const stream = createWriteStream(cmd.redirect.path, { flags });
      const target = cmd.redirect.stream;
      if (target === 'stdout' || target === 'both') {
        child.stdout.pipe(stream);
      }
      if (target === 'stderr' || target === 'both') {
        child.stderr.pipe(stream);
      }
    }

    child.on('close', (code, signal) => {
      resolve({
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: Buffer.concat(stderr).toString('utf-8'),
        exitCode: code,
        signal: signal ?? null,
      });
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        resolve({
          stdout: '',
          stderr: `Command not found: ${cmd.program}`,
          exitCode: 127,
          signal: null,
        });
      } else {
        resolve({
          stdout: '',
          stderr: err.message,
          exitCode: 1,
          signal: null,
        });
      }
    });
  });
}
