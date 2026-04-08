import { createCreateFile } from '../CreateFile/CreateFile';
import { nodeFs } from '../fs/nodeFs.js';

export const CreateFile = createCreateFile(nodeFs);
