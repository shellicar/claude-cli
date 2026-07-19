import type { AzDeps } from '../Az/runAz';
import type { AzAccountsConfig } from '../Az/tools';
import { createAzTools } from '../Az/tools';
import { executor } from '../exec-shared';

export type { AzAccountsConfig, AzDeps };
// Shares the process-wide Executor with ExecV3/GitHub/AzureDevOps (see their entry files), so az
// calls are tracked and reaped by the same exit-sweep handler as every other exec child.
export { createAzTools, executor as azExecutor };
