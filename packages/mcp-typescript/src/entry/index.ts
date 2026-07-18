import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { NodeFileSystem } from '@shellicar/claude-sdk-tools/fs';
import { createTsDefinition } from '@shellicar/claude-sdk-tools/TsDefinition';
import { createTsDiagnostics } from '@shellicar/claude-sdk-tools/TsDiagnostics';
import { createTsHover } from '@shellicar/claude-sdk-tools/TsHover';
import { createTsReferences } from '@shellicar/claude-sdk-tools/TsReferences';
import { DEFAULT_TSSERVER_TIMEOUT_MS, ITsServerClient, ITsServerOptions, ITypeScriptService, resolveTsServerPath, TsServerBridge, TsServerClient } from '@shellicar/claude-sdk-tools/TsService';
import { createServiceCollection } from '@shellicar/core-di-lite';

// biome-ignore-start lint/suspicious/noExplicitAny: mirrors the zod shape registerTool's inputSchema/handler accept across every tool
type AnyToolDefinition = {
  name: string;
  description: string;
  input_schema: any;
  handler: (input: any) => Promise<{ textContent: unknown }>;
};
// biome-ignore-end lint/suspicious/noExplicitAny: mirrors the zod shape registerTool's inputSchema/handler accept across every tool

/** Writes to stderr only: stdio transport owns stdout for the JSON-RPC framing, so ILogger output must never touch it. */
class StderrLogger extends ILogger {
  #write(level: string, message: string, meta: unknown[]): void {
    process.stderr.write(`[mcp-typescript] [${level}] ${message}${meta.length ? ` ${JSON.stringify(meta)}` : ''}\n`);
  }
  public trace(message: string, ...meta: unknown[]): void {
    this.#write('trace', message, meta);
  }
  public debug(message: string, ...meta: unknown[]): void {
    this.#write('debug', message, meta);
  }
  public info(message: string, ...meta: unknown[]): void {
    this.#write('info', message, meta);
  }
  public warn(message: string, ...meta: unknown[]): void {
    this.#write('warn', message, meta);
  }
  public error(message: string, ...meta: unknown[]): void {
    this.#write('error', message, meta);
  }
}

/**
 * Wires the same DI graph `apps/claude-sdk-cli` builds for its TS tools
 * (options -> filesystem/logger -> ITsServerClient -> TsServerBridge), minus
 * the CLI-only pieces (config, sessions, audit) this server has no use for.
 */
function buildTypeScriptService(): ITypeScriptService {
  const services = createServiceCollection();
  services.register(ITsServerOptions).to(ITsServerOptions, () => ({ tsserverPath: resolveTsServerPath(), timeoutMs: DEFAULT_TSSERVER_TIMEOUT_MS }));
  services.register(IFileSystem).to(NodeFileSystem);
  services.register(ILogger).to(StderrLogger);
  services.register(ITsServerClient).to(TsServerClient);
  services.register(ITypeScriptService).to(TsServerBridge);
  return services.buildProvider().resolve(ITypeScriptService);
}

/**
 * Registers one TS tool, treating each MCP tool call as its own block: the
 * bridge starts the tsserver lazily on first use inside the call and this
 * wrapper always ends the block afterwards, win or lose. MCP has no call
 * grouping the way the CLI's turn loop does, so a per-call block is the
 * closest honest match to the CLI's per-block freshness guarantee (a fresh
 * spawn per block means diagnostics are never stale against a file edited
 * between calls) without inventing a batching concept the protocol lacks.
 */
function registerTool(server: McpServer, tsService: ITypeScriptService, def: AnyToolDefinition): void {
  server.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: def.input_schema,
    },
    // biome-ignore lint/suspicious/noExplicitAny: registerTool is generic across four differently-shaped tool inputs
    async (input: any) => {
      try {
        const { textContent: result } = await def.handler(input);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          // MCP requires structuredContent to be a record when present; TsHover
          // legitimately returns null (no symbol at that position), so it is
          // omitted rather than sent as a non-record value.
          ...(result != null && typeof result === 'object' ? { structuredContent: result as Record<string, unknown> } : {}),
        };
      } finally {
        await tsService.blockEnded();
      }
    },
  );
}

export type TypeScriptServer = {
  server: McpServer;
  tsService: ITypeScriptService;
};

/**
 * Create a configured McpServer with the TS tools registered, backed by
 * @shellicar/claude-sdk-tools. tsService is returned alongside the server so
 * the entry point can stop it on shutdown as a backstop for the per-call
 * lifecycle each registered tool already drives (see registerTool).
 */
export function createTypeScriptServer(): TypeScriptServer {
  const server = new McpServer({ name: 'mcp-typescript', version: '1.0.0' });
  const tsService = buildTypeScriptService();

  registerTool(server, tsService, createTsDiagnostics(tsService));
  registerTool(server, tsService, createTsHover(tsService));
  registerTool(server, tsService, createTsReferences(tsService));
  registerTool(server, tsService, createTsDefinition(tsService));

  return { server, tsService };
}
