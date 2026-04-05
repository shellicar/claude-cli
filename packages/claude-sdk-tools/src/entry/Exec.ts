import { createExec } from '../Exec/Exec';
import { nodeFs } from './nodeFs';

export const Exec = createExec(nodeFs);
