import { createDeleteFile } from '../DeleteFile/DeleteFile';
import { NodeFileSystem } from '../fs/NodeFileSystem';

export const DeleteFile = createDeleteFile(new NodeFileSystem());
