import { createRead } from '../Read/Read';
import { nodeFs } from '../fs/nodeFs.js';

export const Read = createRead(nodeFs);
