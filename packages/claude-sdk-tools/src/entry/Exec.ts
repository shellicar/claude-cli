import { createExec } from '../Exec/Exec';
import { ExecInputSchema } from '../Exec/schema';
import type { ExecInput } from '../Exec/types';
import { nodeFs } from '../fs/nodeFs.js';

export type { ExecInput };
export { ExecInputSchema };
export const Exec = createExec(nodeFs);
