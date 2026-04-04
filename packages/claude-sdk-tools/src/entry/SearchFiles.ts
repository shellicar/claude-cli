import { createSearchFiles } from '../SearchFiles/SearchFiles';
import { nodeFs } from './nodeFs';

export const SearchFiles = createSearchFiles(nodeFs);
