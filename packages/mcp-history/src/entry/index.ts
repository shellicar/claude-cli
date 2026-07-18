import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Clock } from '@js-joda/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SqliteHistoryEngine } from '@shellicar/claude-core/history/SqliteHistoryEngine';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { createHistoryTools } from '@shellicar/claude-sdk-tools/History';
import { getDataDir } from '../getDataDir.js';

type SearchHistoryInput = Parameters<ReturnType<typeof createHistoryTools>[0]['handler']>[0];
type ReadHistoryInput = Parameters<ReturnType<typeof createHistoryTools>[1]['handler']>[0];

const consoleLogger: ILogger = {
  trace: () => {},
  debug: () => {},
  info: (message, ...meta) => console.error(message, ...meta),
  warn: (message, ...meta) => console.error(message, ...meta),
  error: (message, ...meta) => console.error(message, ...meta),
};

/**
 * Create a configured McpServer exposing SearchHistory/ReadHistory over this package's own history store.
 * The store lives under `getDataDir('shellicar-mcp-history')`, not the CLI's `~/.claude/history.db` — this is a
 * separate index, not a view onto the CLI's. Nothing currently ingests the CLI's audit logs into it, so the store
 * starts empty until something writes to it.
 *
 * There is no live session here, so `includeCurrentSession: false` on SearchHistory has nothing to exclude —
 * `currentSessionId` always returns an id no stored conversation can carry.
 */
export function createHistoryServer(): McpServer {
  const path = join(getDataDir('shellicar-mcp-history'), 'history.db');
  mkdirSync(dirname(path), { recursive: true });
  const engine = new SqliteHistoryEngine(new DatabaseSync(path), consoleLogger);
  const [SearchHistory, ReadHistory] = createHistoryTools(engine, () => '', Clock.systemDefaultZone());

  const server = new McpServer({ name: 'mcp-history', version: '1.0.0' });

  server.registerTool(SearchHistory.name, { description: SearchHistory.description, inputSchema: SearchHistory.input_schema }, async (input) => {
    const { textContent: result } = await SearchHistory.handler(input as SearchHistoryInput);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: { hits: result } };
  });

  server.registerTool(ReadHistory.name, { description: ReadHistory.description, inputSchema: ReadHistory.input_schema }, async (input) => {
    const { textContent: result } = await ReadHistory.handler(input as ReadHistoryInput);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: { windows: result } };
  });

  return server;
}
