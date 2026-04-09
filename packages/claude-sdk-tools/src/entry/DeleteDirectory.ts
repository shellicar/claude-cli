import { createDeleteDirectory } from '../DeleteDirectory/DeleteDirectory';
import { nodeFs } from '../fs/nodeFs.js';

export const DeleteDirectory = createDeleteDirectory(nodeFs);
