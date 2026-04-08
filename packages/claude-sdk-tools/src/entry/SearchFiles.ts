import { createSearchFiles } from '../SearchFiles/SearchFiles';
import { nodeFs } from '../fs/nodeFs.js';

export const SearchFiles = createSearchFiles(nodeFs);
