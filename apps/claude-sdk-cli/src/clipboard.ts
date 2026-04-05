import { execFile } from 'node:child_process';

function execText(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', timeout: 5000 }, (error, stdout) => {
      if (error) {
        reject(new Error(`${command} failed: ${error.message}`));
        return;
      }
      const text = stdout.trim();
      resolve(text.length > 0 ? text : null);
    });
  });
}

/** Read plain text from the system clipboard. Returns null if empty or unavailable. */
export async function readClipboardText(): Promise<string | null> {
  return execText('pbpaste', []);
}
