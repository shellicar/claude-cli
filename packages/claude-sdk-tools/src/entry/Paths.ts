import { nodeFs } from '../fs/nodeFs.js';
import { createPaths } from '../Paths/Paths';

export const Paths = createPaths(nodeFs);
