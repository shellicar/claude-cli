import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { buildDimensionArgs, buildResizeArgs, parseDimensions } from './conditionImage.js';
import { type ImageDimensions, SipsBridge } from './SipsBridge.js';

const execFileAsync = promisify(execFile);
const SIPS_TIMEOUT_MS = 10_000;

/**
 * Real sips bridge. `sips` is invoked bare (resolved on PATH) — a base macOS tool, like the bare
 * pngpaste/osascript calls in clipboard.ts. It reads and writes files only (no stdin/stdout image
 * mode), so every call stages the bytes in a throwaway temp dir and removes it afterwards.
 * Any spawn error (absent binary → ENOENT) or non-zero exit (a failure on the image → 13) rejects,
 * which conditionImage turns into attach-as-is.
 */
export class NodeSipsBridge extends SipsBridge {
  async dimensions(input: Buffer): Promise<ImageDimensions> {
    return this.#withTempDir(async (dir) => {
      const inputPath = join(dir, 'input');
      await writeFile(inputPath, input);
      const { stdout } = await execFileAsync('sips', buildDimensionArgs(inputPath), { timeout: SIPS_TIMEOUT_MS });
      return parseDimensions(stdout);
    });
  }

  async resizeToPng(input: Buffer): Promise<Buffer> {
    return this.#withTempDir(async (dir) => {
      const inputPath = join(dir, 'input');
      const outputPath = join(dir, 'output.png');
      await writeFile(inputPath, input);
      await execFileAsync('sips', buildResizeArgs(inputPath, outputPath), { timeout: SIPS_TIMEOUT_MS });
      return readFile(outputPath);
    });
  }

  async #withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'claude-sips-'));
    try {
      return await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
