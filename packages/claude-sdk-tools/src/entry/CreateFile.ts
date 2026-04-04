import { createCreateFile } from '../CreateFile/CreateFile';
import { NodeFileSystem } from '../fs/NodeFileSystem';

export const CreateFile = createCreateFile(new NodeFileSystem());
