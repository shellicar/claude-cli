import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { pathSchema } from '@shellicar/claude-sdk';
import type { Ended, Operation, Running, Writer } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { regexPattern } from '../../regexPattern.js';
import { defineToolV2 } from '../defineToolV2.js';
import { NEWLINE } from '../lines.js';
import { walkLazy } from '../walkLazy.js';

export const FindModel = z.object({
  path: pathSchema.describe('Directory to search. Supports absolute, relative, ~ and $HOME.'),
  pattern: regexPattern('Match against file paths', ['\\.ts$', '\\.(ts|js)$']).optional(),
  type: z.enum(['file', 'directory', 'both']).optional(),
  exclude: z.array(z.string()).optional(),
  maxDepth: z.number().int().min(1).optional(),
  followSymlinks: z.boolean().optional(),
});

type FindInput = z.infer<typeof FindModel>;

/** Walks a directory, writing a path at a time. Directory entries, not file content, which is the
 *  same distinction Unix draws between `r` on a directory and `r` on a file. */
export function createFindTool(fs: IFileSystem) {
  return defineToolV2({
    name: 'Find',
    description: 'Find files or directories under a directory. A source: starts a pipe.',
    model: FindModel,
    operations: (): Operation[] => ['fs.list'],

    run: (raw: Record<string, unknown>, _upstream: unknown, out: Writer, say: (line: string) => void): Running => {
      const input = raw as FindInput;
      const re = input.pattern != null ? new RegExp(input.pattern) : undefined;
      const options = { pattern: input.pattern, type: input.type, exclude: input.exclude, maxDepth: input.maxDepth, followSymlinks: input.followSymlinks };
      let ended: Ended = { kind: 'finished' };
      let unreadable = 0;

      const walking = (async () => {
        try {
          for await (const record of walkLazy(fs, input.path, options, 1, re, new Set(), () => void unreadable++)) {
            // A write that is not accepted means the reader has gone, which is the only thing that
            // stops the walk. There is no process here to take a signal.
            if (!(await out.write(Buffer.from(`${record.path}${NEWLINE}`, 'utf8')))) {
              return;
            }
          }
        } catch (err) {
          // Nothing was walked at all, so the answer is not incomplete, it is absent. `find` itself
          // exits 1 when it cannot read what it was pointed at.
          ended = { kind: 'failed', code: 1 };
          say(err instanceof Error ? err.message : String(err));
        }
      })().finally(() => {
        // A count rather than a line each: what a stage says is bounded, and lines past the bound
        // are dropped where nobody sees them, taking the number with them.
        if (unreadable > 0) {
          say(`${unreadable} ${unreadable === 1 ? 'directory' : 'directories'} could not be read`);
        }
        out.end();
      });

      return {
        ended: () => ended,
        stop: async () => {
          await walking;
        },
      };
    },
  });
}
