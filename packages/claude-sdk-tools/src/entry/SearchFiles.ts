import { NodeFileSystem } from '../fs/NodeFileSystem';
import { createSearchFiles } from '../SearchFiles/SearchFiles';

export const SearchFiles = createSearchFiles(new NodeFileSystem());
