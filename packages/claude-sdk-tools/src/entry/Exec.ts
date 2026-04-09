import { createExec } from '../Exec/Exec';
import { nodeFs } from '../fs/nodeFs.js';

export const Exec = createExec(nodeFs);
