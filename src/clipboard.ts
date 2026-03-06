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
  if (bpp !== 24 && bpp !== 32) {
    throw new Error(`Unsupported BMP bit depth: ${bpp}bpp (only 24/32 supported)`);
  }

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

export type ClipboardImageResult = { kind: 'image'; data: Buffer } | { kind: 'no-image'; types: string[] } | { kind: 'empty' } | { kind: 'unsupported' };

async function readPowershell(): Promise<ClipboardImageResult> {
  const data = await execBase64('powershell.exe', ['-NoProfile', '-Command', POWERSHELL_SCRIPT]);
  return data ? { kind: 'image', data } : { kind: 'empty' };
}

async function readWlPaste(log: (msg: string) => void): Promise<ClipboardImageResult> {
  const typesOutput = await execText('wl-paste', ['--list-types']);
  log(`wl-paste types: ${typesOutput ?? '(null)'}`);
  if (!typesOutput) {
    return { kind: 'empty' };
  }
  const types = typesOutput.split('\n').filter((t) => t.length > 0);

  if (types.includes('image/png')) {
    log('Reading image/png');
    const data = await execBuffer('wl-paste', ['--type', 'image/png']);
    return data ? { kind: 'image', data } : { kind: 'empty' };
  }
  if (types.includes('image/bmp')) {
    log('Reading image/bmp, converting to PNG');
    const raw = await execBuffer('wl-paste', ['--type', 'image/bmp']);
    log(`BMP data: ${raw ? `${raw.length} bytes` : '(null)'}`);
    if (raw) {
      const data = await bmpToPng(raw);
      return { kind: 'image', data };
    }
  }
  log(`No image type found in: ${types.join(', ')}`);
  return { kind: 'no-image', types };
}

async function readXclip(): Promise<ClipboardImageResult> {
  const data = await execBuffer('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']);
  return data ? { kind: 'image', data } : { kind: 'empty' };
}

async function readPngpaste(): Promise<ClipboardImageResult> {
  const data = await execBuffer('pngpaste', ['-']);
  return data ? { kind: 'image', data } : { kind: 'empty' };
}

type LogFn = (msg: string) => void;

const METHODS: Record<ClipboardMethod, (log: LogFn) => Promise<ClipboardImageResult>> = {
  powershell: () => readPowershell(),
  'wl-paste': (log) => readWlPaste(log),
  xclip: () => readXclip(),
  pngpaste: () => readPngpaste(),
};

export function resolveMethod(platform: Platform, override?: ClipboardMethod): ClipboardMethod | null {
  return override ?? PLATFORM_DEFAULTS[platform];
}

export async function readClipboardImage(platform: Platform, log: LogFn, override?: ClipboardMethod): Promise<ClipboardImageResult> {
  const method = resolveMethod(platform, override);
  log(`platform=${platform} method=${method ?? '(none)'}`);
  if (!method) {
    return { kind: 'unsupported' };
  }
  return METHODS[method](log);
}

export type ClipboardTextResult = { kind: 'text'; text: string } | { kind: 'no-text'; types: string[] } | { kind: 'empty' } | { kind: 'unsupported' };

async function readWlPasteText(): Promise<ClipboardTextResult> {
  const typesOutput = await execText('wl-paste', ['--list-types']);
  if (!typesOutput) {
    return { kind: 'empty' };
  }
  const types = typesOutput.split('\n').filter((t) => t.length > 0);
  const textType = types.find((t) => t.startsWith('text/'));
  if (!textType) {
    return { kind: 'no-text', types };
  }
  const text = await execText('wl-paste', ['--type', textType]);
  if (!text || text.length === 0) {
    return { kind: 'empty' };
  }
  return { kind: 'text', text };
}

const TEXT_READERS: Partial<Record<Platform, () => Promise<ClipboardTextResult>>> = {
  wsl: () => readWlPasteText(),
  'linux-wayland': () => readWlPasteText(),
  macos: async () => {
    const text = await execText('pbpaste', []);
    return text ? { kind: 'text', text } : { kind: 'empty' };
  },
  'linux-x11': async () => {
    const text = await execText('xclip', ['-selection', 'clipboard', '-o']);
    return text ? { kind: 'text', text } : { kind: 'empty' };
  },
};

export async function readClipboardText(platform: Platform): Promise<ClipboardTextResult> {
  const reader = TEXT_READERS[platform];
  if (!reader) {
    return { kind: 'unsupported' };
  }
  return reader();
}
