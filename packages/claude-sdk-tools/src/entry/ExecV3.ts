import { createExecV3 } from '../ExecV3/ExecV3';
import { ExecV3InputSchema } from '../ExecV3/schema';
import type { ExecV3Input } from '../ExecV3/types';
import { executor } from '../exec-shared';
import { nodeFs } from '../fs/nodeFs.js';

export type { ExecV3Input };
export { ExecV3InputSchema };
export const ExecV3 = createExecV3(nodeFs, executor);
