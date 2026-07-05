import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams, BetaThinkingConfigDisabled } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type { BetaCacheControlEphemeral, BetaClearThinking20251015Edit, BetaClearToolUses20250919Edit, BetaCompact20260112Edit, BetaContentBlockParam, BetaContextManagementConfig, BetaTextBlockParam, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { Model } from '@anthropic-ai/sdk/resources/messages';
import { AnthropicBeta, CacheTtl, COMPACT_BETA } from '../public/enums';
import type { AnthropicBetaFlags, AnyToolDefinition, CompactConfig, ThinkingEffort } from '../public/types';
import { AGENT_SDK_PREFIX } from './consts';

export type RequestParams = {
  body: BetaMessageStreamParams;
  headers: { 'anthropic-beta': string };
};

export type RequestBuilderOptions = {
  model: Model;
  thinking?: boolean;
  thinkingEffort?: ThinkingEffort;
  maxTokens: number;
  systemPrompts?: string[];
  /** The cached CLAUDE.md reminder strings the query runner injected as leading
   * `<system-reminder>` blocks of the first user message. Their count marks how many
   * leading blocks form the stable CLAUDE.md prefix, so a cache breakpoint can sit at
   * the end of that run. */
  cachedReminders?: string[];
  /** Per-turn ephemeral strings injected as `<system-reminder>` blocks after the cache boundary.
   * Assembled by TurnRunner from the one-shot git delta (TurnInput.systemReminder) and the
   * per-turn clock stamp (formatClockStamp). Not persisted in conversation history. */
  systemReminders?: string[];
  tools: AnyToolDefinition[];
  /** Server-side tools prepended to the wire tools array before client tools. */
  serverTools?: BetaToolUnion[];
  /** Applied to each client tool after conversion. Used to add ATU-specific fields without the SDK needing to know about them. */
  transformTool?: (tool: BetaToolUnion) => BetaToolUnion;
  betas?: AnthropicBetaFlags;
  compact?: CompactConfig;
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
 * Mutates `messages` in place to add cache_control to the last block of the
 * leading CLAUDE.md reminder run in the first user message. `count` is how many
 * leading blocks of that message the query runner injected as CLAUDE.md
 * `<system-reminder>` blocks. This breakpoint sits at the same position every
 * turn, so the CLAUDE.md prefix is a cache read after the first turn. No-op when
 * there is no CLAUDE.md content, no first user message, or the boundary block is
 * not a `<system-reminder>` text block. The reminder check is a sanity guard on
 * the positional pick: it does not tell CLAUDE.md apart from a per-turn reminder
 * (they share the tag), it only refuses to mark an unexpected block shape.
 */
export function isSystemReminderBlock(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('<system-reminder>') && trimmed.endsWith('</system-reminder>');
}

function cacheClaudeMdPrefix(messages: Anthropic.Beta.Messages.BetaMessageParam[], count: number, cacheTtl: CacheTtl | undefined): void {
  if (count <= 0) {
    return;
  }

  const idx = messages.findIndex((m) => m.role === 'user');
  if (idx === -1) {
    return;
  }

  const msg = messages[idx];
  if (msg == null || typeof msg.content === 'string') {
    return;
  }

  const block = msg.content[count - 1];
  if (block == null || block.type !== 'text' || !isSystemReminderBlock(block.text)) {
    return;
  }

  msg.content[count - 1] = { ...block, cache_control: { type: 'ephemeral', ttl: cacheTtl } };
}

/**
 * Converts a tool definition to its base wire representation. input_examples are always
 * included; the CLI's transformTool is responsible for stripping them when ATU is not in use.
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
  const customTools: BetaToolUnion[] = options.tools.map((t) => {
    const wire = toWireTool(t);
    return options.transformTool ? options.transformTool(wire) : wire;
  });

  const tools: BetaToolUnion[] = [...(options.serverTools ?? []), ...customTools];

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

  const systemPrompts = [AGENT_SDK_PREFIX, ...(options.systemPrompts ?? [])];

  cacheLastUserMessage(messages, options.cacheTtl ?? CacheTtl.OneHour);

  // Stable CLAUDE.md prefix breakpoint: pinned to the end of the leading reminder run in
  // the first user message, re-applied at the same position every turn so the prefix is a
  // cache read after turn 1. cacheLastUserMessage (above) is the moving write marker.
  cacheClaudeMdPrefix(messages, options.cachedReminders?.length ?? 0, options.cacheTtl ?? CacheTtl.OneHour);

  // Inject ephemeral reminders after the cache boundary — present in this request only, never stored in history.
  // Each entry becomes one <system-reminder> block. Safe to mutate in place because `messages` is a
  // caller-owned clone (see Conversation.cloneForRequest).
  if (options.systemReminders != null && options.systemReminders.length > 0) {
    const lastUserIdx = messages.findLastIndex((m) => m.role === 'user');
    if (lastUserIdx !== -1) {
      const lastUser = messages[lastUserIdx];
      if (lastUser != null) {
        // cacheLastUserMessage (above) has already arrayified the content; assert the invariant and push directly.
        const content = lastUser.content as BetaContentBlockParam[];
        for (const reminder of options.systemReminders) {
          content.push({ type: 'text', text: `<system-reminder>\n${reminder}\n</system-reminder>` });
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
    system: systemPrompts.map((text, i) => ({ type: 'text', text, ...(i === systemPrompts.length - 1 ? { cache_control: { type: 'ephemeral', ttl: options.cacheTtl } } : {}) }) satisfies BetaTextBlockParam),
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
    body.thinking = { type: 'adaptive', display: 'summarized' };
    // output_config (effort) is sent only when thinking is enabled; a disabled request carries the thinking object alone.
    if (options.thinkingEffort != null) {
      body.output_config = { effort: options.thinkingEffort };
    }
  } else {
    body.thinking = { type: 'disabled' } satisfies BetaThinkingConfigDisabled;
  }

  const betaStrings = Object.entries(betas)
    .filter(([, enabled]) => enabled)
    .map(([beta]) => beta);

  if (options.compact?.enabled) {
    betaStrings.push(COMPACT_BETA);
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
