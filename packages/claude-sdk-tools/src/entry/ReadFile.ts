import { createReadFile } from '../ReadFile/ReadFile';
import { nodeFs } from './nodeFs';

export const ReadFile = createReadFile(nodeFs);
