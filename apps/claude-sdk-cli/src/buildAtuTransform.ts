import type { BetaMCPToolset, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { AnyToolDefinition } from '@shellicar/claude-sdk';

type NamedTool = Exclude<BetaToolUnion, BetaMCPToolset>;
type ToolWithInputExamples = Extract<BetaToolUnion, { input_examples?: unknown }>;

function isNamedTool(tool: BetaToolUnion): tool is NamedTool {
  return 'name' in tool;
}

function isToolWithInputExamples(tool: BetaToolUnion): tool is ToolWithInputExamples {
  return 'input_examples' in tool;
}

type AtuConfig = {
  enabled: boolean;
  allowProgrammaticExecution: string[];
  codeExecutionTool: string;
};

/**
 * Returns a transformTool function for every request. When ATU is disabled the
 * function strips input_examples (only meaningful in ATU mode). When ATU is enabled
 * it adds defer_loading and allowed_callers based on the tool definition and config.
 */
export function buildAtuTransform(tools: AnyToolDefinition[], config: AtuConfig): (tool: BetaToolUnion) => BetaToolUnion {
  if (!config.enabled) {
    // ATU disabled: strip input_examples — they are only meaningful in ATU mode
    return (tool: BetaToolUnion): BetaToolUnion => {
      if (!isToolWithInputExamples(tool)) {
        return tool;
      }
      const { input_examples: _, ...base } = tool;
      return base;
    };
  }

  const toolDefsMap = new Map(tools.map((t) => [t.name, t]));
  const allowProgramaticSet = new Set(config.allowProgrammaticExecution);

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
