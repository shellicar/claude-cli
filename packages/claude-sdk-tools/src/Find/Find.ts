import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolDefinition } from '@shellicar/claude-sdk';
import { expandPath } from '@shellicar/mcp-exec';
import { FindInputSchema } from './schema';
import type { FindInput, FindOutput, FindOutputSuccess } from './types';

const isNodeError = (err: unknown, code: string): err is NodeJS.ErrnoException => {
  return err instanceof Error && 'code' in err && err.code === code;
};

function walk(dir: string, input: FindInput, depth: number): string[] {
  if (input.maxDepth !== undefined && depth > input.maxDepth) return [];

  let results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (input.exclude.includes(entry.name)) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (input.type === 'directory' || input.type === 'both') {
        if (!input.pattern || entry.name.match(globToRegex(input.pattern))) {
          results.push(fullPath);
        }
      }
      results = results.concat(walk(fullPath, input, depth + 1));
    } else if (entry.isFile()) {
      if (input.type === 'file' || input.type === 'both') {
        if (!input.pattern || entry.name.match(globToRegex(input.pattern))) {
          results.push(fullPath);
        }
      }
    }
  }

  return results;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

export const Find: ToolDefinition<typeof FindInputSchema, FindOutput> = {
  name: 'Find',
  description: 'Find files or directories. Excludes node_modules and dist by default. Output can be piped into Grep.',
  input_schema: FindInputSchema,
  input_examples: [
    { path: '.' },
    { path: './src', pattern: '*.ts' },
    { path: '.', type: 'directory' },
    { path: '.', pattern: '*.ts', exclude: ['dist', 'node_modules', '.git'] },
  ],
  handler: async (input) => {
    const dir = expandPath(input.path);

    let paths: string[];
    try {
      paths = walk(dir, input, 1);
    } catch (err) {
      if (isNodeError(err, 'ENOENT')) {
        return { error: true, message: 'Directory not found', path: dir } satisfies FindOutput;
      }
      if (isNodeError(err, 'ENOTDIR')) {
        return { error: true, message: 'Path is not a directory', path: dir } satisfies FindOutput;
      }
      throw err;
    }

    const lines = paths.map((p, i) => ({ n: i + 1, text: p, file: p }));
    return { lines, totalLines: lines.length } satisfies FindOutputSuccess;
  },
};
