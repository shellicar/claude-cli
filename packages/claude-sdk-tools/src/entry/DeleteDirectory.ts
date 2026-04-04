import { createDeleteDirectory } from '../DeleteDirectory/DeleteDirectory';
import { nodeFs } from './nodeFs';

export const DeleteDirectory = createDeleteDirectory(nodeFs);
