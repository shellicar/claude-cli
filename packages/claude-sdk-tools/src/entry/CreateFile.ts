import { createCreateFile } from '../CreateFile/CreateFile';
import { nodeFs } from './nodeFs';

export const CreateFile = createCreateFile(nodeFs);
