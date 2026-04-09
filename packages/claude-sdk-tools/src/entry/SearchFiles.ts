import { nodeFs } from '../fs/nodeFs.js';
import { createSearchFiles } from '../SearchFiles/SearchFiles';

export const SearchFiles = createSearchFiles(nodeFs);
