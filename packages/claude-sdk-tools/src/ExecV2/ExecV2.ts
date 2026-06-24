import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool, ToolCancelledError } from '@shellicar/claude-sdk';
import type { IExecutor } from '@shellicar/exec-core';
import { builtinRules } from '../Exec/builtinRules';
import { stripAnsi } from '../Exec/stripAnsi';
import { execSignal } from '../exec-shared';
import { collectLeaves, executeTree } from './executeTree';
import { ExecV2InputSchema, ExecV2OutputSchema } from './schema';
import type { Pipeline } from './types';

/**
 * Walk the tree and return a new Pipeline with every Command leaf's path-like fields
 * expanded (`~` and `$VAR` in `program`, `cwd`). Mirrors V1's normaliseInput for the
 * AST shape — V2 has no `steps` array to map over.
 */
function normaliseTree(pipeline: Pipeline, fs: IFileSystem): Pipeline {
  if ('program' in pipeline) {
    return {
      ...pipeline,
      program: expandPath(pipeline.program, fs),
      cwd: expandPath(pipeline.cwd, fs),
    };
  }
  return {
    ...pipeline,
    left: normaliseTree(pipeline.left, fs),
    right: normaliseTree(pipeline.right, fs),
  };
}

export function createExecV2(fs: IFileSystem, executor: IExecutor) {
  return defineTool({
    name: 'ExecV2',
    operation: 'write',
    description:
      "Use this instead of the Bash tool. Execute commands as a structured tree, not a shell string. A `pipeline` is either a single command `{ id, program, args }` or an operation `{ op, left, right }` joining two pipelines. `op` is one of: `;` run both in sequence, `&&` run right only if left exits 0, `||` run right only if left is non-zero, `&` run both concurrently, `|` pipe left's stdout into right's stdin. Each command's `id` is echoed on its result entry so you can match results to commands.",
    input_schema: ExecV2InputSchema,
    output_schema: ExecV2OutputSchema,
    input_examples: [
      {
        description: 'Run a command',
        pipeline: { id: 'a', program: 'echo', args: ['hello'] },
      },
    ],
    handler: async (input, signal) => {
      const cwd = process.cwd();
      const normalised = normaliseTree(input.pipeline, fs);
      const leaves = collectLeaves(normalised);

      // V2 inherits V1's blocked-command validation. The rules walk every leaf.
      const errors: string[] = [];
      const leavesAsV1 = leaves as unknown as Parameters<(typeof builtinRules)[number]['check']>[0];
      for (const rule of builtinRules) {
        const err = rule.check(leavesAsV1);
        if (err) {
          errors.push(`[${rule.name}] ${err}`);
        }
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

      const [results, aggregateExit] = await executeTree(normalised, { cwd, signal: execSignal(signal, input.timeout), executor });
      if (signal?.aborted) {
        throw new ToolCancelledError();
      }

      const clean = input.stripAnsi ? stripAnsi : (s: string) => s;
      const finalResults = results.map((r) => ({
        ...r,
        stdout: clean(r.stdout).trimEnd(),
        stderr: clean(r.stderr).trimEnd(),
      }));
      const success = aggregateExit === 0;

      return { textContent: { results: finalResults, success } };
    },
  });
}
