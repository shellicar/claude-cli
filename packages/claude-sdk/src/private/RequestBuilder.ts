import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type { BetaCacheControlEphemeral, BetaClearThinking20251015Edit, BetaClearToolUses20250919Edit, BetaCompact20260112Edit, BetaContextManagementConfig, BetaTextBlockParam, BetaToolSearchToolBm25_20251119, BetaToolSearchToolRegex20251119, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { Model } from '@anthropic-ai/sdk/resources/messages';
import { AnthropicBeta, CacheTtl, COMPACT_BETA } from '../public/enums';
import type { AdvancedToolsCodeExecutionTool, AdvancedToolsConfig, AnthropicBetaFlags, AnyToolDefinition, CompactConfig } from '../public/types';
import { AGENT_SDK_PREFIX } from './consts';

export type RequestParams = {
  body: BetaMessageStreamParams;
  headers: { 'anthropic-beta': string };
};

export type RequestBuilderOptions = {
  model: Model;
  thinking?: boolean;
  maxTokens: number;
  systemPrompts?: string[];
  systemReminder?: string;
  tools: AnyToolDefinition[];
  betas?: AnthropicBetaFlags;
  compact?: CompactConfig;
  advancedTools?: AdvancedToolsConfig;
  cacheTtl?: CacheTtl;
};

/**
 * Mutates `msg` in place to add a cache_control marker on the last non-thinking
 * content block. If content is a raw string it is wrapped as an array block.
 * Caller must own `msg` (see Conversation.cloneForRequest).
 */
function addCacheControlToLastBlock(msg: Anthropic.Beta.Messages.BetaMessageParam, cacheTtl: CacheTtl | undefined): void {
  const cache_control = { type: 'ephemeral' as const, ttl: cacheTtl };

  if (typeof msg.content === 'string') {
    msg.content = [{ type: 'text', text: msg.content, cache_control }];
    return;
  }

  const idx = msg.content.findLastIndex((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
  if (idx === -1) {
    return;
  }

  const block = msg.content[idx];
  if (block == null || block.type === 'thinking' || block.type === 'redacted_thinking') {
    return;
  }

  msg.content[idx] = { ...block, cache_control };
}

/**
 * Mutates `messages` in place to add cache_control to the last user message.
 * No-op when there is no user message in the array.
 */
function cacheLastUserMessage(messages: Anthropic.Beta.Messages.BetaMessageParam[], cacheTtl: CacheTtl | undefined): void {
  const idx = messages.findLastIndex((m) => m.role === 'user');
  if (idx === -1) {
    return;
  }

  const msg = messages[idx];
  if (msg == null) {
    return;
  }

  addCacheControlToLastBlock(msg, cacheTtl);
}

/**
 * Converts a tool definition to its base wire representation. input_examples are always
 * included; buildRequestParams gates them on ATU being enabled.
 */
export function toWireTool(tool: AnyToolDefinition): BetaToolUnion {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema.toJSONSchema({ target: 'draft-07', io: 'input' }) as Anthropic.Tool['input_schema'],
    input_examples: tool.input_examples,
  } satisfies BetaToolUnion;
}

/**
 * Pure function — builds the Anthropic API request params from agent options
 * and the current message list. No I/O, no client reference, no signal.
 *
 * The turn runner calls this and adds the AbortSignal before passing to the
 * client, since the signal is tied to the per-query abort lifecycle.
 */
export function buildRequestParams(options: RequestBuilderOptions, messages: Anthropic.Beta.Messages.BetaMessageParam[]): RequestParams {
  const atuEnabled = options.advancedTools?.enabled === true;
  const allowProgramaticSet = new Set(options.advancedTools?.allowProgramaticExecution ?? []);
  const codeExecutionTool: AdvancedToolsCodeExecutionTool = options.advancedTools?.codeExecutionTool ?? 'code_execution_20260120';

  const customTools: BetaToolUnion[] = options.tools.map((t) => ({
    ...toWireTool(t),
    input_examples: atuEnabled ? t.input_examples : undefined,
    defer_loading: atuEnabled ? t.defer_loading : undefined,
    allowed_callers: atuEnabled && allowProgramaticSet.has(t.name)
      ? ['direct', codeExecutionTool]
      : undefined,
  }) as BetaToolUnion);

  const tools: BetaToolUnion[] = [];
  if (atuEnabled && options.advancedTools?.searchTool != null) {
    const searchTool =
      options.advancedTools.searchTool === 'regex'
        ? ({ name: 'tool_search_tool_regex', type: 'tool_search_tool_regex_20251119' } satisfies BetaToolSearchToolRegex20251119)
        : ({ name: 'tool_search_tool_bm25', type: 'tool_search_tool_bm25_20251119' } satisfies BetaToolSearchToolBm25_20251119);
    tools.push(searchTool);
  }
  tools.push(...customTools);

  const betas = resolveCapabilities(options.betas, AnthropicBeta);

  const context_management: BetaContextManagementConfig['edits'] = [];
  if (betas[AnthropicBeta.ContextManagement]) {
    context_management.push({ type: 'clear_thinking_20251015' } satisfies BetaClearThinking20251015Edit);
    context_management.push({ type: 'clear_tool_uses_20250919' } satisfies BetaClearToolUses20250919Edit);
  }
  if (options.compact?.enabled) {
    context_management.push({
      type: 'compact_20260112',
      pause_after_compaction: options.compact.pauseAfterCompaction,
      instructions: options.compact.customInstructions ?? null,
      trigger: { type: 'input_tokens', value: options.compact.inputTokens },
    } satisfies BetaCompact20260112Edit);
  }

  const systemPrompts = [AGENT_SDK_PREFIX];
  if (options.systemPrompts != null && options.systemPrompts.length > 0) {
    systemPrompts.push(`\n${options.systemPrompts.join('\n\n')}`);
  }

  cacheLastUserMessage(messages, options.cacheTtl ?? CacheTtl.OneHour);

  // Inject ephemeral context after the cache boundary — present in this request only, never stored in history.
  // Safe to mutate in place because `messages` is a caller-owned clone (see Conversation.cloneForRequest).
  if (options.systemReminder) {
    const lastUserIdx = messages.findLastIndex((m) => m.role === 'user');
    if (lastUserIdx !== -1) {
      const lastUser = messages[lastUserIdx];
      if (lastUser != null) {
        const reminderBlock: BetaTextBlockParam = { type: 'text', text: `<system-reminder>\n${options.systemReminder}\n</system-reminder>` };
        if (typeof lastUser.content === 'string') {
          lastUser.content = [{ type: 'text', text: lastUser.content }, reminderBlock];
        } else {
          lastUser.content.push(reminderBlock);
        }
      }
    }
  }

  const lastTool = tools[tools.length - 1];
  if (lastTool != null) {
    lastTool.cache_control = {
      type: 'ephemeral',
      ttl: options.cacheTtl,
    };
  }

  const body: BetaMessageStreamParams = {
    model: options.model,
    max_tokens: options.maxTokens,
    tools,
    system: systemPrompts.map((text) => ({ type: 'text', text, cache_control: { type: 'ephemeral', ttl: options.cacheTtl } }) satisfies BetaTextBlockParam),
    messages,
    stream: true,
  } satisfies BetaMessageStreamParams;
  if (context_management.length > 0) {
    body.context_management = {
      edits: context_management,
    };
  }

  if (betas[AnthropicBeta.PromptCachingScope]) {
    body.cache_control = { type: 'ephemeral', scope: 'global' } as BetaCacheControlEphemeral;
  }
  if (options.thinking === true) {
    body.thinking = { type: 'adaptive' };
  }

  const betaStrings = Object.entries(betas)
    .filter(([, enabled]) => enabled)
    .map(([beta]) => beta);

  if (options.compact?.enabled) {
    betaStrings.push(COMPACT_BETA);
  }

  if (options.advancedTools?.enabled) {
    betaStrings.push(AnthropicBeta.AdvancedToolUse);
  }

  return {
    body,
    headers: { 'anthropic-beta': betaStrings.join(',') },
  };
}

function resolveCapabilities<T extends string>(partial: Partial<Record<T, boolean>> | undefined, enumObj: Record<string, T>): Record<T, boolean> {
  const result = {} as Record<T, boolean>;
  for (const key of Object.values(enumObj)) {
    result[key] = partial?.[key] ?? false;
  }
  return result;
}
