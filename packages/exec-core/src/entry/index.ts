import { Executor } from '../Executor.js';
import { fromStream } from '../fromStream.js';
import { PipeConsumerGone } from '../reasons.js';
import type { CommandSpec, ExitStatus, IExecutor, SpawnOpts } from '../types.js';

export type { CommandSpec, ExitStatus, IExecutor, SpawnOpts };
export { Executor, fromStream, PipeConsumerGone };
