import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMemoryTools } from '@shellicar/claude-sdk-tools/Memory';
import { openMemoryDatabase } from '../openMemoryDatabase.js';
import { SqliteMemoryEngine } from '../SqliteMemoryEngine.js';
import { SqliteMemoryStore } from '../SqliteMemoryStore.js';

/** Create a configured McpServer with the memory tools registered, backed by @shellicar/claude-sdk-tools, storing to this package's own store under the XDG data directory for `shellicar-mcp-memory`. `dataDir` overrides the resolved directory; tests pass a scratch one instead. */
export function createMemoryServer(dataDir?: string): McpServer {
  const db = dataDir === undefined ? openMemoryDatabase() : openMemoryDatabase('memory.db', dataDir);
  const store = new SqliteMemoryStore(new SqliteMemoryEngine(db));
  const server = new McpServer({ name: 'mcp-memory', version: '1.0.0' });

  for (const tool of createMemoryTools(store)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input_schema.shape,
      },
      async (input: Record<string, unknown>) => {
        const { textContent } = await tool.handler(input as never);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(textContent) }],
          structuredContent: textContent as Record<string, unknown>,
        };
      },
    );
  }

  return server;
}
