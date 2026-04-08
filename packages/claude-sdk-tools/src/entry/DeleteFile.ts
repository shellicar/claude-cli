import { createDeleteFile } from '../DeleteFile/DeleteFile';
import { nodeFs } from '../fs/nodeFs.js';

export const DeleteFile = createDeleteFile(nodeFs);
