import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { NodeFileSystem } from '@shellicar/claude-sdk-tools/fs';
import { createTsDefinition } from '@shellicar/claude-sdk-tools/TsDefinition';
import { createTsDiagnostics } from '@shellicar/claude-sdk-tools/TsDiagnostics';
import { createTsHover } from '@shellicar/claude-sdk-tools/TsHover';
import { createTsReferences } from '@shellicar/claude-sdk-tools/TsReferences';
import { ITsServerClient, ITsServerOptions, ITypeScriptService, resolveTsServerPath, TsServerBridge, TsServerClient } from '@shellicar/claude-sdk-tools/TsService';
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
 * The CLI's `DEFAULT_TSSERVER_TIMEOUT_MS` (3000ms) is tuned for its own
 * lifecycle, where one `tsserver` is started once per block and reused for
 * every TS tool call inside it. Here every single call spawns its own fresh
 * `tsserver` (see `registerTool`), so a cold spawn is on the critical path far
 * more often; a busier host (CI, or a dev machine already under load) can
 * push that past 3s. A more forgiving ceiling costs nothing in the common
 * case and avoids spurious timeouts in the uncommon one.
 */
const TSSERVER_TIMEOUT_MS = 10_000;

/**
 * Wires the same DI graph `apps/claude-sdk-cli` builds for its TS tools
 * (options -> filesystem/logger -> ITsServerClient -> TsServerBridge), minus
 * the CLI-only pieces (config, sessions, audit) this server has no use for.
 */
function buildTypeScriptService(): ITypeScriptService {
  const services = createServiceCollection();
  services.register(ITsServerOptions).to(ITsServerOptions, () => ({ tsserverPath: resolveTsServerPath(), timeoutMs: TSSERVER_TIMEOUT_MS }));
  services.register(IFileSystem).to(NodeFileSystem);
  services.register(ILogger).to(StderrLogger);
  services.register(ITsServerClient).to(TsServerClient);
  services.register(ITypeScriptService).to(TsServerBridge);
  return services.buildProvider().resolve(ITypeScriptService);
}

type ToolFactory = (ts: ITypeScriptService) => AnyToolDefinition;

/**
 * Registers one TS tool. stdio MCP permits a client to pipeline overlapping
 * `tools/call` requests, unlike the CLI's single-threaded turn loop, so a
 * `tsService` shared across calls would let one call's teardown kill the
 * `tsserver` process out from under another call still using it. Building a
 * fresh `ITypeScriptService` (and so a fresh `tsserver` child process) inside
 * every call sidesteps that: there is nothing shared to race over, and each
 * call's `finally` tears down only its own instance.
 *
 * `factory(...)` is called once up front purely to read the static
 * name/description/input_schema for registration; that throwaway instance is
 * never started (`ITypeScriptService` only spawns `tsserver` lazily, on the
 * first actual tool call it handles), so it costs nothing.
 */
function registerTool(server: McpServer, active: Set<ITypeScriptService>, factory: ToolFactory): void {
  const meta = factory(buildTypeScriptService());
  server.registerTool(
    meta.name,
    {
      description: meta.description,
      inputSchema: meta.input_schema,
    },
    // biome-ignore lint/suspicious/noExplicitAny: registerTool is generic across four differently-shaped tool inputs
    async (input: any) => {
      const start = Date.now();
      process.stderr.write(`[mcp-typescript] [timing] ${meta.name} start ${start} (${active.size} already in flight)\n`);
      const tsService = buildTypeScriptService();
      active.add(tsService);
      try {
        const { textContent: result } = await factory(tsService).handler(input);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          // MCP requires structuredContent to be a record when present; TsHover
          // legitimately returns null (no symbol at that position), so it is
          // omitted rather than sent as a non-record value.
          ...(result != null && typeof result === 'object' ? { structuredContent: result as Record<string, unknown> } : {}),
        };
      } finally {
        active.delete(tsService);
        await tsService.blockEnded();
        process.stderr.write(`[mcp-typescript] [timing] ${meta.name} end ${Date.now()} (${Date.now() - start}ms)\n`);
      }
    },
  );
}

export type TypeScriptServer = {
  server: McpServer;
  /** The `tsService` instances currently in flight, one per overlapping call.
   * Exposed so the entry point can tear each of them down on shutdown as a
   * backstop for calls interrupted mid-flight; every call already tears down
   * its own instance in its `finally` on the ordinary completion path. */
  active: ReadonlySet<ITypeScriptService>;
};

/**
 * Create a configured McpServer with the TS tools registered, backed by
 * @shellicar/claude-sdk-tools.
 */
export function createTypeScriptServer(): TypeScriptServer {
  const server = new McpServer({ name: 'mcp-typescript', version: '1.0.0' });
  const active = new Set<ITypeScriptService>();

  registerTool(server, active, createTsDiagnostics);
  registerTool(server, active, createTsHover);
  registerTool(server, active, createTsReferences);
  registerTool(server, active, createTsDefinition);

  return { server, active };
}
