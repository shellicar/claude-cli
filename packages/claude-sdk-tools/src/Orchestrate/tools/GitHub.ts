import type { ToolV2Result } from '@shellicar/orchestrate-core';
import { fromLines } from '@shellicar/orchestrate-core';
import type { z } from 'zod';
import type { GhPrToolSpec } from '../../GitHub/createGhPrTool.js';
import { type GhEscalatedDeps, runGhEscalated } from '../../GitHub/runGhEscalated.js';
import { ghPrAutoMergeSpec, ghPrCommentSpec, ghPrCreateSpec, ghPrEditSpec, ghPrReadySpec, ghPrReviewSpec } from '../../GitHub/specs.js';
import { defineToolV2 } from '../defineToolV2.js';

/** One named GitHub.PullRequest.* V2 tool from a `GhPrToolSpec` — the exact same spec (name,
 *  schema, subcommand, buildArgs) V1's `createGhPrTool` builds from, and the exact same
 *  `runGhEscalated`, so the arg-building logic and the run mechanics are identical between V1
 *  and V2; only the tool-definition wrapper differs. `escalate`: a privilege-boundary crossing
 *  (the holder token) that must always ask, never subject to Policy's ordinary fs.* tiers — see
 *  the `Operation` type in orchestrate-core. */
function createGhPrToolV2<TSchema extends z.ZodType<{ cwd?: string }>>(spec: GhPrToolSpec<TSchema>, deps: GhEscalatedDeps) {
  return defineToolV2({
    name: spec.name,
    description: spec.description,
    operation: 'escalate',
    model: spec.input_schema,
    run: (input, _upstream, stderr): ToolV2Result => {
      let ok = true;

      async function* run(): AsyncGenerator<string, void, unknown> {
        const cwd = input.cwd ?? process.cwd();
        const result = await runGhEscalated(deps, spec.subcommand, spec.buildArgs(input), cwd);
        ok = result.exitCode === 0;
        const stdout = result.stdout.trim();
        if (stdout.length > 0) {
          yield* stdout.split('\n');
        }
        const stderrText = result.stderr.trim();
        if (stderrText.length > 0) {
          stderr.push(...stderrText.split('\n'));
        }
      }

      return { stdout: fromLines(run()), success: () => ok };
    },
  });
}

/** The six named GitHub.PullRequest.* V2 tools, sharing deps with V1's `createGhPrTools` — same
 *  holder credential, same executor. */
export function createGhPrToolsV2(deps: GhEscalatedDeps) {
  return [createGhPrToolV2(ghPrCreateSpec, deps), createGhPrToolV2(ghPrReadySpec, deps), createGhPrToolV2(ghPrEditSpec, deps), createGhPrToolV2(ghPrCommentSpec, deps), createGhPrToolV2(ghPrAutoMergeSpec, deps), createGhPrToolV2(ghPrReviewSpec, deps)] as const;
}
