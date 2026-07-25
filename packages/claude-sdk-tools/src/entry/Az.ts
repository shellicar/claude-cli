import { AzSessionCache } from '../Az/AzSessionCache';
import type { AzDeps } from '../Az/runAz';
import { AZ_CLI_TOOL_NAME, type AzAccountsConfig, createAzTools, ESCALATED_AZ_CLI_TOOL_NAME } from '../Az/tools';
import { executor } from '../exec-shared';

export type { AzAccountsConfig, AzDeps };
// Shares the process-wide Executor with ExecV3/GitHub/AzureDevOps (see their entry files), so az
// calls are tracked and reaped by the same exit-sweep handler as every other exec child.
//
// AzSessionCache is a value export, not just a type: the composition root constructs exactly one
// instance and shares it between createAzTools and AzureDevOps's createAdoPrTools (see
// createAppTools.ts), so a login warmed by one is reused by the other.
export { AZ_CLI_TOOL_NAME, AzSessionCache, createAzTools, ESCALATED_AZ_CLI_TOOL_NAME, executor as azExecutor };
