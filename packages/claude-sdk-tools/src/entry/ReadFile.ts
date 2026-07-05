import { NodeSipsBridge } from '@shellicar/claude-core/image/NodeSipsBridge';
import { nodeFs } from '../fs/nodeFs.js';
import { createReadFile } from '../ReadFile/ReadFile';

export const ReadFile = createReadFile(nodeFs, new NodeSipsBridge());
