import { Executor } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import { execCommand } from '../../src/Exec/execCommand';
import type { Command } from '../../src/Exec/types';
import { Exec } from '../../src/entry/Exec';
import { call } from '../helpers';

// Reviewer red tests (Phase 1). Each asserts the PRE-consolidation (main) behaviour.
// They are expected to run RED against feature/exec-core, proving a behaviour drift.

// ---------------------------------------------------------------------------
// Finding 1 — merge_stderr + redirect:stdout drops the merged stderr.
//
// On main, execCommand with merge_stderr and a stdout redirect captured the
// child's stderr into result.stdout (the merge target) while the child's stdout
// flowed to the redirect file. After consolidation, resolveSinks evaluates
// merge_stderr first, pointing stderr at the same Writable as stdout — the
// redirect file — so the merged stderr lands in the file and result.stdout is
// empty. This asserts the old behaviour: the merged stderr is captured.
// ---------------------------------------------------------------------------

describe('Finding 1 — merge_stderr + redirect:stdout', () => {
  it('captures the merged stderr into stdout (main behaviour)', async () => {
    const executor = new Executor();
    const cmd = {
      program: 'sh',
      args: ['-c', 'echo OUT; echo ERR >&2'],
      merge_stderr: true,
      redirect: { path: '/dev/null', stream: 'stdout', append: false },
    } satisfies Command;

    const actual = await execCommand(cmd, process.cwd(), undefined, executor);

    expect(actual.stdout).toContain('ERR');
  });
});

// ---------------------------------------------------------------------------
// Finding 2 — bad cwd on a non-final pipeline stage returns 127, not 126.
//
// On main, execPipeline pre-checked every command's cwd and returned exit 126
// for any missing directory. After consolidation, the per-stage 126 from
// exec-core trips intermediateSpawnFail, which forces the overall exit to 127.
// This asserts the old behaviour: exit 126.
// ---------------------------------------------------------------------------

describe('Finding 2 — bad cwd on a non-final pipeline stage', () => {
  it('reports exit code 126 (main behaviour)', async () => {
    const result = await call(Exec, {
      description: 'bad cwd on first pipeline stage',
      steps: [
        {
          commands: [
            { program: 'echo', args: ['hello'], cwd: '/nonexistent/path/xyz123abc' },
            { program: 'cat' },
          ],
        },
      ],
    });
    const expected = 126;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });
});
