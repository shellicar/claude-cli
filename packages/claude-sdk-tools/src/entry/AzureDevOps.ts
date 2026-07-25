import type { AdoEscalatedDeps } from '../AzureDevOps/createAdoPrTool';
import { ADO_PR_TOOL_NAMES, createAdoPrTools } from '../AzureDevOps/tools';
import { executor } from '../exec-shared';

export type { AdoEscalatedDeps };
// Shares the process-wide Executor with ExecV3 (see entry/ExecV3.ts) and GitHub (see entry/GitHub.ts),
// so ado escalated calls are tracked and reaped by the same exit-sweep handler as every other exec child.
export { ADO_PR_TOOL_NAMES, createAdoPrTools, executor as adoExecutor };
