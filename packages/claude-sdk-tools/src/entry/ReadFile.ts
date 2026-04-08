import { createReadFile } from '../ReadFile/ReadFile';
import { nodeFs } from '../fs/nodeFs.js';

export const ReadFile = createReadFile(nodeFs);
