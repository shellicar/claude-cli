import { createFind } from '../Find/Find';
import { nodeFs } from './nodeFs';

export const Find = createFind(nodeFs);
