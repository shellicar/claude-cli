import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool } from '@shellicar/claude-sdk';
import { builtinRules } from '../Exec/builtinRules';
import { stripAnsi } from '../Exec/stripAnsi';
import { collectLeaves, executeTree } from './executeTree';
import { ExecV2InputSchema, ExecV2OutputSchema } from './schema';
import type { Pipeline } from './types';

/**
 * Walk the tree and return a new Pipeline with every Command leaf's path-like fields
 * expanded (`~` and `$VAR` in `program`, `cwd`, `redirect.path`). Mirrors V1's
 * `normaliseInput` but for the AST shape — V2 has no `steps` array to map over.
 */
function normaliseTree(pipeline: Pipeline, fs: IFileSystem): Pipeline {
  if ('program' in pipeline) {
    return {
      ...pipeline,
      program: expandPath(pipeline.program, fs),
      cwd: expandPath(pipeline.cwd, fs),
      redirect: pipeline.redirect && { ...pipeline.redirect, path: expandPath(pipeline.redirect.path, fs) },
    };
  }
  return {
    ...pipeline,
    left: normaliseTree(pipeline.left, fs),
    right: normaliseTree(pipeline.right, fs),
  };
}

export function createExecV2(fs: IFileSystem) {
  return defineTool({
    name: 'Exec',
    operation: 'write',
    description: 'ExecV2: structural redesign in progress.',
    input_schema: ExecV2InputSchema,
    output_schema: ExecV2OutputSchema,
    input_examples: [
      {
        description: 'Run a command',
        pipeline: { id: 'a', program: 'echo', args: ['hello'] },
      },
    ],
    handler: async (input) => {
      const cwd = process.cwd();
      const normalised = normaliseTree(input.pipeline, fs);
      const leaves = collectLeaves(normalised);

      // V2 inherits V1's blocked-command validation. The rules walk every leaf in the
      // tree, so a deep case like `echo a && rm /tmp/x` is rejected upfront just like a
      // top-level `rm`. The synthetic _blocked result mirrors V1's shape so callers can
      // detect blocked input the same way across versions.
      const errors: string[] = [];
      // The V1 rule type takes the V1 Command shape; V2 Command is a structural
      // superset (adds `id`), so it satisfies every property the rules read.
      const leavesAsV1 = leaves as unknown as Parameters<(typeof builtinRules)[number]['check']>[0];
      for (const rule of builtinRules) {
        const err = rule.check(leavesAsV1);
        if (err) errors.push(`[${rule.name}] ${err}`);
      }
      if (errors.length > 0) {
        return {
          textContent: {
            results: [
              {
                id: '_blocked',
                stdout: '',
                stderr: `BLOCKED:\n${errors.join('\n')}`,
                exitCode: 1,
                signal: null,
              },
            ],
            success: false,
          },
        };
      }

      const [results, aggregateExit] = await executeTree(normalised, { cwd, timeout: input.timeout });
      const clean = input.stripAnsi ? stripAnsi : (s: string) => s;
      const finalResults = results.map((r) => ({
        ...r,
        stdout: clean(r.stdout).trimEnd(),
        stderr: clean(r.stderr).trimEnd(),
      }));
      // `success` follows the operator's aggregate exit, not a per-leaf reduction. For
      // `||` (O2, M1) the left's failing leaf is still in `results`, but the right
      // succeeded, so the aggregate is zero and `success` is true — the contract the V2
      // tests pin down. A naive `results.every(...)` flag would mis-report these cases.
      const success = aggregateExit === 0;

      return { textContent: { results: finalResults, success } };
    },
  });
}
