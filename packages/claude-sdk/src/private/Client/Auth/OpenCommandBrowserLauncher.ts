import { execFile } from 'node:child_process';
import { IBrowserLauncher } from './interfaces';

export class OpenCommandBrowserLauncher extends IBrowserLauncher {
  public open(url: string): void {
    execFile('open', [url]);
  }
}
