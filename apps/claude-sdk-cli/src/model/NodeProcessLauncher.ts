import { spawn } from 'node:child_process';
import { IProcessLauncher, type LaunchOptions } from './IProcessLauncher.js';

export class NodeProcessLauncher extends IProcessLauncher {
  public launch(command: string, options: LaunchOptions): void {
    const child = spawn(command, [...(options.args ?? [])], { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      // Swallow spawn failures (e.g. ENOENT). The hook is fire-and-forget;
      // a missing or invalid command should not crash the CLI.
    });
    child.unref();
  }
}
