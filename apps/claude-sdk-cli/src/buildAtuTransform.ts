import type { BetaMCPToolset, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { AnyToolDefinition } from '@shellicar/claude-sdk';

type NamedTool = Exclude<BetaToolUnion, BetaMCPToolset>;

function isNamedTool(tool: BetaToolUnion): tool is NamedTool {
  return 'name' in tool;
}

type AtuConfig = {
  enabled: boolean;
  allowProgramaticExecution: string[];
  codeExecutionTool: string;
};

/**
 * Returns a transformTool function for ATU-enabled requests, or undefined when
 * ATU is disabled. The returned function adds defer_loading and allowed_callers
 * to each client tool based on its definition and the ATU config.
 */
export function buildAtuTransform(
  tools: AnyToolDefinition[],
  config: AtuConfig,
): ((tool: BetaToolUnion) => BetaToolUnion) | undefined {
  if (!config.enabled) {
    return undefined;
  }

  const toolDefsMap = new Map(tools.map((t) => [t.name, t]));
  const allowProgramaticSet = new Set(config.allowProgramaticExecution);

  return (tool: BetaToolUnion): BetaToolUnion => {
    if (!isNamedTool(tool)) {
      return tool;
    }
    const def = toolDefsMap.get(tool.name);
    return {
      ...tool,
      defer_loading: def?.defer_loading ?? undefined,
      allowed_callers: allowProgramaticSet.has(tool.name) ? ['direct', config.codeExecutionTool] : undefined,
    } as BetaToolUnion;
  };
}
