import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import type { Command, Step, BashPlusPlusInput } from './schema.js';

export interface StepResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
}

export interface ExecutionResult {
  results: StepResult[];
  success: boolean;
}

/** Execute a single command via child_process.spawn (no shell). */
function execCommand(cmd: Command, cwd: string, timeoutMs?: number): Promise<StepResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd.program, cmd.args ?? [], {
      cwd: cmd.cwd ?? cwd,
      env: cmd.env ? { ...process.env, ...cmd.env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    // Pipe stdin if provided
    if (cmd.stdin !== undefined) {
      child.stdin.write(cmd.stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    // Handle redirect
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

/** Execute a pipeline of commands with stdout→stdin piping. */
async function execPipeline(commands: Command[], cwd: string, timeoutMs?: number): Promise<StepResult> {
  if (commands.length === 0) {
    return { stdout: '', stderr: '', exitCode: 0, signal: null };
  }

  return new Promise((resolve) => {
    const children = commands.map((cmd, i) => {
      const child = spawn(cmd.program, cmd.args ?? [], {
        cwd: cmd.cwd ?? cwd,
        env: cmd.env ? { ...process.env, ...cmd.env } : process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
      });

      // Pipe stdin for first command
      if (i === 0 && cmd.stdin !== undefined) {
        child.stdin.write(cmd.stdin);
        child.stdin.end();
      } else if (i === 0) {
        child.stdin.end();
      }

      return child;
    });

    // Connect pipes: stdout of each → stdin of next
    for (let i = 0; i < children.length - 1; i++) {
      children[i].stdout.pipe(children[i + 1].stdin);
    }

    const lastChild = children[children.length - 1];
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    lastChild.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));

    // Collect stderr from all commands
    for (const child of children) {
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    }

    // Handle redirect on last command
    const lastCmd = commands[commands.length - 1];
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
          stderr: `Command not found: ${commands[commands.length - 1].program}`,
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

/** Execute a single step (command or pipeline). */
async function execStep(step: Step, cwd: string, timeoutMs?: number): Promise<StepResult> {
  if (step.type === 'command') {
    const { type: _, ...cmd } = step;
    return execCommand(cmd, cwd, timeoutMs);
  }
  return execPipeline(step.commands, cwd, timeoutMs);
}

/** Execute all steps according to the chaining strategy. */
export async function execute(input: BashPlusPlusInput, cwd: string): Promise<ExecutionResult> {
  const results: StepResult[] = [];

  for (const step of input.steps) {
    const result = await execStep(step, cwd, input.timeout);
    results.push(result);

    if (input.chaining === 'bail_on_error' && result.exitCode !== 0) {
      return { results, success: false };
    }
  }

  const success = results.every((r) => r.exitCode === 0);
  return { results, success };
}
