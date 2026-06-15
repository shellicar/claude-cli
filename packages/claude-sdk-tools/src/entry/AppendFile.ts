import { createAppendFile } from '../AppendFile/AppendFile';
import { nodeFs } from '../fs/nodeFs.js';

export const AppendFile = createAppendFile(nodeFs);
