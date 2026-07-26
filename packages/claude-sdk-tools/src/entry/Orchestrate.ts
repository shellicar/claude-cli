import { executor } from '../exec-shared';
import { OrchestrateEngine } from '../Orchestrate/OrchestrateEngine';
import { createToolsV2Registry, toolsV2WireTools } from '../Orchestrate/registry';
import type { ToolsV2Registry, ToolsV2RegistryDeps, WireStage } from '../Orchestrate/registry';
import { runToolV2Call } from '../Orchestrate/runToolV2Call';

export type { ToolsV2Registry, ToolsV2RegistryDeps, WireStage };
// Shares the process-wide Executor with ExecV3/Az/GitHub/AzureDevOps (see their entry files),
// so a Program call is tracked and reaped by the same exit-sweep handler as every other exec child.
export { createToolsV2Registry, OrchestrateEngine, runToolV2Call, toolsV2WireTools, executor as orchestrateExecutor };
