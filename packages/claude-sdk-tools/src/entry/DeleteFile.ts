import { createDeleteFile } from '../DeleteFile/DeleteFile';
import { nodeFs } from './nodeFs';

export const DeleteFile = createDeleteFile(nodeFs);
