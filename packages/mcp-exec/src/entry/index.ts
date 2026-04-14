import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Exec } from '@shellicar/claude-sdk-tools/Exec';

type ExecInput = Parameters<(typeof Exec)['handler']>[0];
type ExecOutput = Awaited<ReturnType<(typeof Exec)['handler']>>;

/** Create a configured McpServer with the exec tool registered, backed by @shellicar/claude-sdk-tools. */
export function createExecServer(): McpServer {
  const server = new McpServer({ name: 'mcp-exec', version: '1.0.0' });

  server.registerTool(
    'exec',
    {
      description: Exec.description,
      inputSchema: Exec.input_schema,
    },
    async (input) => {
      const result = await Exec.handler(input as ExecInput);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result as ExecOutput,
        isError: !result.success,
      };
    },
  );

  return server;
}
