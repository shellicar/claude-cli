import { NodeFileSystem } from '../fs/NodeFileSystem';
import { createReadFile } from '../ReadFile/ReadFile';

export const ReadFile = createReadFile(new NodeFileSystem());
