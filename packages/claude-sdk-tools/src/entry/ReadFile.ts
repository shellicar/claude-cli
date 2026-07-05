import { NodeSipsBridge } from '@shellicar/claude-core/image/NodeSipsBridge';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { nodeFs } from '../fs/nodeFs.js';
import { createReadFile } from '../ReadFile/ReadFile';

// The real sips bridge is constructed here, but the logger is injected by the app so the tool's
// conditioning outcomes land in the app's debug log (this package has no logger of its own).
export const createReadFileTool = (logger: ILogger) => createReadFile(nodeFs, new NodeSipsBridge(), logger);
