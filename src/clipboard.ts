import { execFile } from 'node:child_process';
import type { Platform } from './platform.js';

function execBuffer(command: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const child = execFile(command, args, { encoding: 'buffer', timeout: 5000 }, (error, stdout) => {
      if (error || !stdout || stdout.length === 0) {
        resolve(null);
        return;
      }
      resolve(stdout);
    });
    child.stdin?.end();
  });
}

function execBase64(command: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout) => {
      if (error || !stdout || stdout.trim().length === 0) {
        resolve(null);
        return;
      }
      resolve(Buffer.from(stdout.trim(), 'base64'));
    });
  });
}

const POWERSHELL_SCRIPT = ['Add-Type -AssemblyName System.Windows.Forms', '$img = [System.Windows.Forms.Clipboard]::GetImage()', 'if ($img -ne $null) {', '  $ms = New-Object System.IO.MemoryStream', '  $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)', '  [Convert]::ToBase64String($ms.ToArray())', '}'].join(
  '; ',
);

export async function readClipboardImage(platform: Platform): Promise<Buffer | null> {
  try {
    switch (platform) {
      case 'wsl':
      case 'windows-bash':
        return await execBase64('powershell.exe', ['-NoProfile', '-Command', POWERSHELL_SCRIPT]);
      case 'linux-x11':
        return await execBuffer('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']);
      case 'linux-wayland':
        return await execBuffer('wl-paste', ['--type', 'image/png']);
      case 'macos':
        return await execBuffer('pngpaste', ['-']);
      case 'unknown':
        return null;
    }
  } catch {
    return null;
  }
}
