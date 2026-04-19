import { spawn } from 'node:child_process';
import { IProcessLauncher } from './IProcessLauncher.js';

export class NodeProcessLauncher extends IProcessLauncher {
  public launch(command: string, args: string[]): void {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  }
}
