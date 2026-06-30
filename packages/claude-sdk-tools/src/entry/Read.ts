import { nodeFs } from '../fs/nodeFs.js';
import { createRead } from '../Read/Read';

export const Read = createRead(nodeFs);
