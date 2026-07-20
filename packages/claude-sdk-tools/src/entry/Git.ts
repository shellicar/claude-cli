import type { GitDeps } from '../Git/runGit';
import { createGitTools } from '../Git/tools';
import { executor } from '../exec-shared';
import { nodeFs } from '../fs/nodeFs.js';

export type { GitDeps };
// Shares the process-wide Executor with ExecV3/GitHub/AzureDevOps/Az (see their entry files), so
// git calls are tracked and reaped by the same exit-sweep handler as every other exec child.
export { createGitTools, executor as gitExecutor, nodeFs as gitFs };
