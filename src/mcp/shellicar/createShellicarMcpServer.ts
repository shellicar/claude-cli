import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { ShellicarMcpServerName } from './consts';
import { createExecTool } from './exec/createExecTool';
import type { ShellicarMcpOptions } from './types';
import { builtinRules } from './validation/consts';

/**
 * Creates an in-process MCP server providing the Exec structured command tool.
 *
 * Usage:
 * ```typescript
 * const mcpServer = createShellicarMcpServer({ cwd: process.cwd() });
 * // Pass to SDK options:
 * // mcpServers: { shellicar: mcpServer }
 * // disallowedTools: ['Bash']
 * ```
 */
export function createShellicarMcpServer(options?: ShellicarMcpOptions) {
  const cwd = options?.cwd ?? process.cwd();
  const rules = options?.rules ?? builtinRules;

  const execTool = createExecTool(cwd, rules);
  // const execTool = tool(ShellicarExecToolName, ShellicarExecDescription, ShellicarExecInputSchema.shape, createHandler(cwd, rules));

  return createSdkMcpServer({
    name: ShellicarMcpServerName,
    version: '0.1.0',
    tools: [execTool],
  });
}
