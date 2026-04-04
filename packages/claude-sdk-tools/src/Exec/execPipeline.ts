import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import type { PipelineCommands, StepResult } from './types';

/** Execute a pipeline of commands with stdout→stdin piping. */
export async function execPipeline(commands: PipelineCommands, cwd: string, timeoutMs?: number): Promise<StepResult> {
  if (commands.length === 0) {
    return { stdout: '', stderr: '', exitCode: 0, signal: null };
  }

  if (!existsSync(cwd)) {
    return { stdout: '', stderr: `Working directory not found: ${cwd}`, exitCode: 126, signal: null };
  }

  for (const cmd of commands) {
    const cmdCwd = cmd.cwd ?? cwd;
    if (!existsSync(cmdCwd)) {
      return { stdout: '', stderr: `Working directory not found: ${cmdCwd}`, exitCode: 126, signal: null };
    }
  }

  return new Promise((resolve) => {
    const children = commands.map((cmd, i) => {
      const cmdCwd = cmd.cwd ?? cwd;
      const child = spawn(cmd.program, cmd.args ?? [], {
        cwd: cmdCwd,
        env: cmd.env ? { ...process.env, ...cmd.env } : process.env,
        stdio: 'pipe',
        timeout: timeoutMs,
      });

      if (i === 0 && cmd.stdin !== undefined) {
        child.stdin.write(cmd.stdin);
        child.stdin.end();
      } else if (i === 0) {
        child.stdin.end();
      }

      return child;
    });

    // Connect pipes: stdout (and optionally stderr) of each → stdin of next
    for (let i = 0; i < children.length - 1; i++) {
      const curr = children[i];
      const currCmd = commands[i];
      const next = children[i + 1];
      if (curr !== undefined && next !== undefined) {
        if (currCmd?.merge_stderr) {
          const merged = new PassThrough();
          curr.stdout.pipe(merged);
          curr.stderr.pipe(merged);
          merged.pipe(next.stdin);
        } else {
          curr.stdout.pipe(next.stdin);
        }
      }
    }

    const lastChild = children[children.length - 1];
    const lastCmd = commands[commands.length - 1];
    if (lastChild === undefined || lastCmd === undefined) {
      resolve({ stdout: '', stderr: '', exitCode: 0, signal: null });
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    lastChild.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));

    for (let i = 0; i < children.length; i++) {
      const isMerged = commands[i]?.merge_stderr && i < children.length - 1;
      if (!isMerged) {
        children[i]?.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      }
    }

    if (lastCmd.redirect) {
      const flags = lastCmd.redirect.append ? 'a' : 'w';
      const stream = createWriteStream(lastCmd.redirect.path, { flags });
      const target = lastCmd.redirect.stream;
      if (target === 'stdout' || target === 'both') {
        lastChild.stdout.pipe(stream);
      }
      if (target === 'stderr' || target === 'both') {
        lastChild.stderr.pipe(stream);
      }
    }

    lastChild.on('close', (code, signal) => {
      resolve({
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: Buffer.concat(stderr).toString('utf-8'),
        exitCode: code,
        signal: signal ?? null,
      });
    });

    lastChild.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        resolve({
          stdout: '',
          stderr: `Command not found: ${lastCmd.program}`,
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
