import { createDeleteDirectory } from '../DeleteDirectory/DeleteDirectory';
import { NodeFileSystem } from '../fs/NodeFileSystem';

export const DeleteDirectory = createDeleteDirectory(new NodeFileSystem());
