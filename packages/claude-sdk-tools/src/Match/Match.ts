import { z } from 'zod';
import { collectMatchedIndices } from '../collectMatchedIndices';
import { defineComposable } from '../composable';
import type { Stream } from '../stream';

export const MatchModel = z.object({
  pattern: z.string().describe('Regular expression pattern to search for'),
  caseInsensitive: z.boolean().default(false).describe('Case insensitive matching'),
  before: z.number().int().min(0).default(0).describe("Lines of context before each match (grep's -B; content grain only)"),
  after: z.number().int().min(0).default(0).describe("Lines of context after each match (grep's -A; content grain only)"),
});

export const Match = defineComposable({
  name: 'Match',
  description: 'Keep matches. On a file list, keeps files whose path matches; on file contents, keeps matching lines. Stage.',
  operation: 'read',
  model: MatchModel,
  input_examples: [{ pattern: 'TODO' }, { pattern: 'export', before: 2, after: 2 }, { pattern: 'todo', caseInsensitive: true }],
  pipe: { in: 'any', out: 'same' },
  run: async ({ pattern, caseInsensitive, before, after, input }): Promise<Stream> => {
    const re = new RegExp(pattern, caseInsensitive ? 'i' : '');
    if (input.kind === 'files') {
      return { kind: 'files', files: input.files.filter((f) => re.test(f.path)) };
    }
    const files = input.files
      .map((f) => {
        const texts = f.lines.map((l) => l.text);
        const keep = collectMatchedIndices(texts, re, before, after);
        return { ...f, lines: keep.map((i) => f.lines[i]) };
      })
      .filter((f) => f.lines.length > 0);
    return { kind: 'content', files };
  },
});
