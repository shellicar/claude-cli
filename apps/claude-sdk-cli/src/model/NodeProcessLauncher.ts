import { spawn } from 'node:child_process';
import { IProcessLauncher, type LaunchOptions } from './IProcessLauncher.js';

export class NodeProcessLauncher extends IProcessLauncher {
  public launch(command: string, options: LaunchOptions): void {
    const hasStdin = options.stdin !== undefined;
    const child = spawn(command, [...(options.args ?? [])], {
      detached: true,
      stdio: hasStdin ? ['pipe', 'ignore', 'ignore'] : 'ignore',
    });
    child.on('error', () => {
      // Swallow spawn failures (e.g. ENOENT). The hook is fire-and-forget;
      // a missing or invalid command should not crash the CLI.
    });
    if (hasStdin && child.stdin !== null) {
      // Stdin can also emit EPIPE if the child exits before reading. Swallow
      // so the CLI does not crash on a misbehaving hook.
      child.stdin.on('error', () => {});
      child.stdin.end(options.stdin);
    }
    child.unref();
  }
}
