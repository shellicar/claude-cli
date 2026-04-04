import { createReadFile } from '../ReadFile/ReadFile';
import { NodeFileSystem } from '../fs/NodeFileSystem';

export const ReadFile = createReadFile(new NodeFileSystem());
