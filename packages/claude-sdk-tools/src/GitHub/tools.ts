import { createGhPrTool, type GhEscalatedDeps } from './createGhPrTool';
import { ghPrAutoMergeSpec, ghPrCommentSpec, ghPrCreateSpec, ghPrEditSpec, ghPrReadySpec, ghPrReviewSpec } from './specs';

/** The six named, typed GitHub.PullRequest.* tools. Each hardcodes which gh subcommand and flags it
 *  ever emits — the structural guarantee a generic `GhCli { command }` proposer cannot give, because
 *  GitHub's fine-grained PAT permissions don't go below the `Pull requests: read-write` bucket.
 *
 *  The specs themselves live in `./specs.ts`, shared verbatim with the V2 tools — this function only
 *  wires them to V1's `defineTool`-shaped `createGhPrTool`. */
export function createGhPrTools(deps: GhEscalatedDeps) {
  return [createGhPrTool(ghPrCreateSpec, deps), createGhPrTool(ghPrReadySpec, deps), createGhPrTool(ghPrEditSpec, deps), createGhPrTool(ghPrCommentSpec, deps), createGhPrTool(ghPrAutoMergeSpec, deps), createGhPrTool(ghPrReviewSpec, deps)] as const;
}
