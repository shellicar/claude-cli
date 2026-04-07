import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type { BetaCacheControlEphemeral, BetaClearThinking20251015Edit, BetaClearToolUses20250919Edit, BetaCompact20260112Edit, BetaContextManagementConfig, BetaTextBlockParam, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta.mjs';
import { AnthropicBeta } from '../public/enums';
import type { RunAgentQuery } from '../public/types';
import { AGENT_SDK_PREFIX } from './consts';

export type RequestParams = {
  body: BetaMessageStreamParams;
  headers: { 'anthropic-beta': string };
};

/**
 * Pure function — builds the Anthropic API request params from agent options
 * and the current message list. No I/O, no client reference, no signal.
 *
 * AgentRun calls this and adds the AbortSignal before passing to the client,
 * since the signal is tied to AgentRun's abort lifecycle.
 */
export function buildRequestParams(options: RunAgentQuery, messages: Anthropic.Beta.Messages.BetaMessageParam[]): RequestParams {
  const tools: BetaToolUnion[] = options.tools.map(
    (t) =>
      ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema.toJSONSchema({ target: 'draft-07', io: 'input' }) as Anthropic.Tool['input_schema'],
        input_examples: t.input_examples,
      }) satisfies BetaToolUnion,
  );

  const betas = resolveCapabilities(options.betas, AnthropicBeta);

  const context_management: BetaContextManagementConfig = {
    edits: [],
  };
  if (betas[AnthropicBeta.ContextManagement]) {
    context_management.edits?.push({ type: 'clear_thinking_20251015' } satisfies BetaClearThinking20251015Edit);
    context_management.edits?.push({ type: 'clear_tool_uses_20250919' } satisfies BetaClearToolUses20250919Edit);
  }
  if (betas[AnthropicBeta.Compact]) {
    context_management.edits?.push({
      type: 'compact_20260112',
      pause_after_compaction: options.pauseAfterCompact ?? false,
      trigger: options.compactInputTokens
        ? {
            type: 'input_tokens',
            value: options.compactInputTokens,
          }
        : null,
    } satisfies BetaCompact20260112Edit);
  }

  const systemPrompts = [AGENT_SDK_PREFIX];
  if (options.systemPrompts != null && options.systemPrompts.length > 0) {
    systemPrompts.push(`\n${options.systemPrompts.join('\n\n')}`);
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
    context_management,
    system: systemPrompts.map((text) => ({ type: 'text', text, cache_control: { type: 'ephemeral', ttl: options.cacheTtl  } } satisfies BetaTextBlockParam)),
    messages,
    stream: true,
  } satisfies BetaMessageStreamParams;

  if (betas[AnthropicBeta.PromptCachingScope]) {
    body.cache_control = { type: 'ephemeral', scope: 'global' } as BetaCacheControlEphemeral;
  }
  if (options.thinking === true) {
    body.thinking = { type: 'adaptive' };
  }

  const anthropicBetas = Object.entries(betas)
    .filter(([, enabled]) => enabled)
    .map(([beta]) => beta)
    .join(',');

  return {
    body,
    headers: { 'anthropic-beta': anthropicBetas },
  };
}

function resolveCapabilities<T extends string>(partial: Partial<Record<T, boolean>> | undefined, enumObj: Record<string, T>): Record<T, boolean> {
  const result = {} as Record<T, boolean>;
  for (const key of Object.values(enumObj)) {
    result[key] = partial?.[key] ?? false;
  }
  return result;
}
