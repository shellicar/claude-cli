import { createExecV2 } from '../ExecV2/ExecV2';
import { ExecV2InputSchema } from '../ExecV2/schema';
import type { ExecV2Input } from '../ExecV2/types';
import { executor } from '../exec-shared';
import { nodeFs } from '../fs/nodeFs.js';

export type { ExecV2Input };
export { ExecV2InputSchema };
export const ExecV2 = createExecV2(nodeFs, executor);
