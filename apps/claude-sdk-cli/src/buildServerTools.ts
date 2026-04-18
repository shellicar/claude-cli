import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { ILogger } from '@shellicar/claude-sdk';

export type AllowedCaller = 'direct' | 'code_execution';

type WebSearchConfig = {
  enabled: boolean;
  version: 'web_search_20250305' | 'web_search_20260209';
  allowedCallers: AllowedCaller[];
};

type WebFetchConfig = {
  enabled: boolean;
  version: 'web_fetch_20250910' | 'web_fetch_20260209';
  allowedCallers: AllowedCaller[];
};

export type ServerToolsConfig = {
  webSearch: WebSearchConfig;
  webFetch: WebFetchConfig;
};

type ResolvedCaller = 'direct' | 'code_execution_20250825' | 'code_execution_20260120';

function resolveCallers(callers: AllowedCaller[], codeExecutionTool: 'code_execution_20250825' | 'code_execution_20260120'): ResolvedCaller[] {
  return callers.map((c) => (c === 'code_execution' ? codeExecutionTool : c));
}

export function buildServerTools(config: ServerToolsConfig, codeExecutionTool: 'code_execution_20250825' | 'code_execution_20260120', logger?: ILogger): BetaToolUnion[] {
  const tools: BetaToolUnion[] = [];

  if (config.webSearch.enabled) {
    tools.push({
      name: 'web_search',
      type: config.webSearch.version,
      allowed_callers: resolveCallers(config.webSearch.allowedCallers, codeExecutionTool),
    } as BetaToolUnion);
  }

  if (config.webFetch.enabled) {
    tools.push({
      name: 'web_fetch',
      type: config.webFetch.version,
      allowed_callers: resolveCallers(config.webFetch.allowedCallers, codeExecutionTool),
    } as BetaToolUnion);
  }

  logger?.info('build_server_tools', { input: { config, codeExecutionTool }, output: tools });
  return tools;
}
