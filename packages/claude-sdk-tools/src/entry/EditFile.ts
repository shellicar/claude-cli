import { createEditFile } from '../EditFile/EditFile';
import { NodeFileSystem } from '../fs/NodeFileSystem';

export const EditFile = createEditFile(new NodeFileSystem());
