import { executor } from '../exec-shared';
import { OrchestrateEngine } from '../Orchestrate/OrchestrateEngine';
import type { ToolsV2RegistryDeps, WireStage } from '../Orchestrate/registry';
import { createToolsV2Registry, ToolsV2Registry, toolsV2WireTools } from '../Orchestrate/registry';
import { runToolV2Call } from '../Orchestrate/runToolV2Call';

export type { ToolsV2RegistryDeps, WireStage };
// Shares the process-wide Executor with ExecV3/Az/GitHub/AzureDevOps (see their entry files),
// so a Program call is tracked and reaped by the same exit-sweep handler as every other exec child.
// ToolsV2Registry is a real value export, not just a type: a caller needing an empty registry
// (e.g. a test double for anything that only depends on ToolsV2Service, never on any real V2
// tool) constructs `new ToolsV2Registry([])` directly rather than routing through
// createToolsV2Registry with a pile of unused fake dependencies.
export { createToolsV2Registry, executor as orchestrateExecutor, OrchestrateEngine, runToolV2Call, ToolsV2Registry, toolsV2WireTools };
