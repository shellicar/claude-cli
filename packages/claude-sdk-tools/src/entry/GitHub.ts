import { executor } from '../exec-shared';
import type { GhEscalatedDeps } from '../GitHub/createGhPrTool';
import { createGhPrTools } from '../GitHub/tools';

export type { GhEscalatedDeps };
// Shares the process-wide Executor with ExecV3 (see entry/ExecV3.ts), so gh escalated calls are
// tracked and reaped by the same exit-sweep handler as every other exec child.
export { createGhPrTools, executor as ghExecutor };
