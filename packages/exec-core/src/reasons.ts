/**
 * Abort reason marking a teardown caused by a pipe consumer exiting. The orchestrator
 * aborts a producer's signal with this reason; Executor maps it to a SIGPIPE kill, so the
 * producer dies from signal 13 and reports `signal: 'SIGPIPE'` honestly, rather than being
 * killed with SIGTERM and relabelled. The reason vocabulary lives here so the tool imports it from
 * exec-core, keeping the dependency pointing into the core rather than out of it.
 */
export const PipeConsumerGone = Symbol('PipeConsumerGone');
