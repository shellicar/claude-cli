import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ExecV3 } from '@shellicar/claude-sdk-tools/ExecV3';

type ExecInput = Parameters<(typeof ExecV3)['handler']>[0];
type ExecOutput = Awaited<ReturnType<(typeof ExecV3)['handler']>>['textContent'];

/** Create a configured McpServer with the exec tool registered, backed by @shellicar/claude-sdk-tools. */
export function createExecServer(): McpServer {
  const server = new McpServer({ name: 'mcp-exec', version: '1.0.0' });

  server.registerTool(
    'exec',
    {
      description: ExecV3.description,
      inputSchema: ExecV3.input_schema,
    },
    async (input) => {
      const { textContent: result } = await ExecV3.handler(input as ExecInput);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result as ExecOutput,
        isError: !result.success,
      };
    },
  );

  return server;
}
