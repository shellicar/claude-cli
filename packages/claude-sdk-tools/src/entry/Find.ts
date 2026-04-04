import { createFind } from '../Find/Find';
import { NodeFileSystem } from '../fs/NodeFileSystem';

export const Find = createFind(new NodeFileSystem());
