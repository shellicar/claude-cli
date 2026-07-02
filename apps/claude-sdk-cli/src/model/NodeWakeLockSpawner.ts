import { spawn } from 'node:child_process';
import { IWakeLockSpawner, type WakeLockProcess } from './IWakeLockSpawner.js';

/**
 * Spawns the wake-lock helper, returning a handle to kill it on release. stdio is
 * ignored; spawn failures (e.g. ENOENT when the command is not on PATH) are
 * swallowed — the feature must silently do nothing, never error. Mirrors the
 * swallow in NodeProcessLauncher.
 */
export class NodeWakeLockSpawner extends IWakeLockSpawner {
  public spawn(command: string, args: readonly string[]): WakeLockProcess {
    const child = spawn(command, [...args], { stdio: 'ignore' });
    child.on('error', () => {
      // Swallow: a wake lock is best-effort. A missing command must never crash the CLI.
    });
    return { kill: () => child.kill() };
  }
}
