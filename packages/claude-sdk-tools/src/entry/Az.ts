import { executor } from '../exec-shared';
import type { AzAccountsConfig } from '../Az/tools';
import { createAzTools } from '../Az/tools';
import type { AzDeps } from '../Az/runAz';

export type { AzAccountsConfig, AzDeps };
// Shares the process-wide Executor with ExecV3/GitHub/AzureDevOps (see their entry files), so az
// calls are tracked and reaped by the same exit-sweep handler as every other exec child.
export { createAzTools, executor as azExecutor };
