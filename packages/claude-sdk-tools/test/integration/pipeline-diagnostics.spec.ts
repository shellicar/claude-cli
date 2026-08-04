import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ExecV3, ExecV3InputSchema } from '../../src/entry/ExecV3';

// The executor synthesises two diagnostics itself, rather than getting them from the child:
// "Command not found" (ENOENT) and "Working directory not found" (missing cwd). Both are
// written to the stage's stderr sink, or to its stdout sink when the stage merges with
// "&1". A non-terminal stage has no stdout sink — its stdout is the OS pipe — so a merged
// non-terminal stage has nowhere to put them and they are dropped: the stage reports 127 or
// 126 with no explanation anywhere in the result. Without the merge the same stage reports
// the message correctly, which is what makes this a hole rather than a design.
//
// The assertion is deliberately weak: the message must reach the caller somewhere, in this
// stage's own stderr or downstream in the pipe. Which of the two is the right home is a
// separate question this does not prejudge.

const messageSomewhereIn = async (input: z.input<typeof ExecV3InputSchema>): Promise<string> => {
  const { textContent } = await ExecV3.handler(ExecV3InputSchema.parse(input));
  return textContent.results.map((r) => (r == null ? '' : `${r.stdout}${r.stderr}`)).join('');
};

describe('a merged non-terminal stage reports why it failed', () => {
  it('surfaces "Command not found" when the program does not exist', async () => {
    const haystack = await messageSomewhereIn({
      intent: 'pipe a missing program, merging its stderr, into cat',
      commands: [{ program: 'definitely-not-a-real-command-xyzzy', redirect: { stderr: '&1' }, op: '|' }, { program: 'cat' }],
    });

    const expected = true;
    const actual = haystack.includes('Command not found');
    expect(actual).toBe(expected);
  });

  it('surfaces "Working directory not found" when the cwd is missing', async () => {
    const haystack = await messageSomewhereIn({
      intent: 'pipe a stage with a missing cwd, merging its stderr, into cat',
      commands: [{ program: 'echo', args: ['hi'], cwd: '/nonexistent/path/xyzzy', redirect: { stderr: '&1' }, op: '|' }, { program: 'cat' }],
    });

    const expected = true;
    const actual = haystack.includes('Working directory not found');
    expect(actual).toBe(expected);
  });
});
