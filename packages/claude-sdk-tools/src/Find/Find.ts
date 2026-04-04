import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolDefinition } from '@shellicar/claude-sdk';
import { expandPath } from '@shellicar/mcp-exec';
import { FindInputDefaults, FindInputSchema } from './schema';
import type { FindInput, FindInputType, FindOutput } from './types';

type WalkInput = {
  path: string;
  pattern: string | undefined;
  type: FindInputType;
  exclude: string[];
  maxDepth: number | undefined;
};

function walk(dir: string, input: WalkInput, depth: number): string[] {
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

export const Find: ToolDefinition<FindInput, FindOutput> = {
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
    const paths = walk(dir, applyDefaults(input), 1);
    return { paths, totalCount: paths.length };
  },
};

function applyDefaults(input: FindInput): WalkInput {
  const { path, pattern, type = FindInputDefaults.type, exclude = FindInputDefaults.exclude, maxDepth } = input;
  return { path, pattern, type, exclude, maxDepth };
}
