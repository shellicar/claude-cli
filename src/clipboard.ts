import { execFile } from 'node:child_process';
import sharp from 'sharp';
import type { Platform } from './platform.js';

export type ClipboardMethod = 'powershell' | 'wl-paste' | 'xclip' | 'pngpaste';

const PLATFORM_DEFAULTS: Record<Platform, ClipboardMethod | null> = {
  wsl: 'wl-paste',
  'windows-bash': 'powershell',
  'linux-x11': 'xclip',
  'linux-wayland': 'wl-paste',
  macos: 'pngpaste',
  unknown: null,
};

const MAX_IMAGE_BUFFER = 50 * 1024 * 1024;

function execBuffer(command: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { encoding: 'buffer', timeout: 5000, maxBuffer: MAX_IMAGE_BUFFER }, (error, stdout) => {
      if (error) {
        reject(new Error(`${command} failed: ${error.message}`));
        return;
      }
      if (!stdout || stdout.length === 0) {
        resolve(null);
        return;
      }
      resolve(stdout);
    });
    child.stdin?.end();
  });
}

function execBase64(command: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', timeout: 10000, maxBuffer: MAX_IMAGE_BUFFER }, (error, stdout) => {
      if (error) {
        reject(new Error(`${command} failed: ${error.message}`));
        return;
      }
      if (!stdout || stdout.trim().length === 0) {
        resolve(null);
        return;
      }
      resolve(Buffer.from(stdout.trim(), 'base64'));
    });
  });
}

function execText(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', timeout: 5000 }, (error, stdout) => {
      if (error) {
        reject(new Error(`${command} failed: ${error.message}`));
        return;
      }
      if (!stdout) {
        resolve(null);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

const POWERSHELL_SCRIPT = ['Add-Type -AssemblyName System.Windows.Forms', '$img = [System.Windows.Forms.Clipboard]::GetImage()', 'if ($img -ne $null) {', '  $ms = New-Object System.IO.MemoryStream', '  $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)', '  [Convert]::ToBase64String($ms.ToArray())', '}'].join(
  '; ',
);

function bmpToPng(buf: Buffer): Promise<Buffer> {
  const magic = buf.toString('utf8', 0, 2);
  if (magic !== 'BM') {
    throw new Error('Not a BMP file');
  }

  const dataOffset = buf.readUInt32LE(10);
  const width = buf.readUInt32LE(18);
  let height = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);

  const bottomUp = height > 0;
  height = Math.abs(height);

  const channels = bpp / 8;
  const rowSize = Math.ceil((width * channels) / 4) * 4;
  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    const srcY = bottomUp ? height - 1 - y : y;
    const srcRow = dataOffset + srcY * rowSize;
    const dstRow = y * width * 4;

    for (let x = 0; x < width; x++) {
      const srcIdx = srcRow + x * channels;
      const dstIdx = dstRow + x * 4;
      // BMP is BGRA (32bpp) or BGR (24bpp) -> RGBA
      pixels[dstIdx] = buf[srcIdx + 2];
      pixels[dstIdx + 1] = buf[srcIdx + 1];
      pixels[dstIdx + 2] = buf[srcIdx];
      pixels[dstIdx + 3] = channels === 4 ? buf[srcIdx + 3] : 255;
    }
  }

  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

async function readPowershell(): Promise<Buffer | null> {
  return execBase64('powershell.exe', ['-NoProfile', '-Command', POWERSHELL_SCRIPT]);
}

async function readWlPaste(log: (msg: string) => void): Promise<Buffer | null> {
  const typesOutput = await execText('wl-paste', ['--list-types']);
  log(`wl-paste types: ${typesOutput ?? '(null)'}`);
  if (!typesOutput) {
    return null;
  }
  const types = typesOutput.split('\n');

  if (types.includes('image/png')) {
    log('Reading image/png');
    return execBuffer('wl-paste', ['--type', 'image/png']);
  }
  if (types.includes('image/bmp')) {
    log('Reading image/bmp, converting to PNG');
    const raw = await execBuffer('wl-paste', ['--type', 'image/bmp']);
    log(`BMP data: ${raw ? `${raw.length} bytes` : '(null)'}`);
    if (raw) {
      return bmpToPng(raw);
    }
  }
  log(`No image type found in: ${types.join(', ')}`);
  return null;
}

async function readXclip(): Promise<Buffer | null> {
  return execBuffer('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']);
}

async function readPngpaste(): Promise<Buffer | null> {
  return execBuffer('pngpaste', ['-']);
}

type LogFn = (msg: string) => void;

const METHODS: Record<ClipboardMethod, (log: LogFn) => Promise<Buffer | null>> = {
  powershell: () => readPowershell(),
  'wl-paste': (log) => readWlPaste(log),
  xclip: () => readXclip(),
  pngpaste: () => readPngpaste(),
};

export function resolveMethod(platform: Platform, override?: ClipboardMethod): ClipboardMethod | null {
  return override ?? PLATFORM_DEFAULTS[platform];
}

export async function readClipboardImage(platform: Platform, log: LogFn, override?: ClipboardMethod): Promise<Buffer | null> {
  const method = resolveMethod(platform, override);
  log(`platform=${platform} method=${method ?? '(none)'}`);
  if (!method) {
    return null;
  }
  const result = await METHODS[method](log);
  log(`result: ${result ? `${result.length} bytes` : '(null)'}`);
  return result;
}
