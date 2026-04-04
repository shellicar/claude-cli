import { createConfirmEditFile } from '../EditFile/ConfirmEditFile';
import { NodeFileSystem } from '../fs/NodeFileSystem';

export const ConfirmEditFile = createConfirmEditFile(new NodeFileSystem());
