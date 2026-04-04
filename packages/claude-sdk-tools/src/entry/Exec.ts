import { createExec } from '../Exec/Exec';
import { NodeFileSystem } from '../fs/NodeFileSystem';

export const Exec = createExec(new NodeFileSystem());
