import { createPaths } from '../Paths/Paths';
import { nodeFs } from '../fs/nodeFs.js';

export const Paths = createPaths(nodeFs);
