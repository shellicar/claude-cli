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

/**
 * Read a file path from the clipboard.
 * Tries plain text first (e.g. a path copied from terminal or VS Code "Copy Path"),
 * then falls back to AppleScript to extract the POSIX path from a Finder file reference
 * (i.e. a file copied with ⌘C in Finder).
 * Returns null if neither yields a path.
 */
export async function readClipboardPath(): Promise<string | null> {
  const text = await readClipboardText().catch(() => null);
  if (text) {
    return text;
  }
  return execText('osascript', ['-e', 'POSIX path of (the clipboard as \u00abclass furl\u00bb)']).catch(() => null);
}

