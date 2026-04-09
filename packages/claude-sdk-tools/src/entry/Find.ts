import { createFind } from '../Find/Find';
import { nodeFs } from '../fs/nodeFs.js';

export const Find = createFind(nodeFs);
