import type { Anthropic } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { BetaMessageParam } from '../src/index.js';
import { AGENT_SDK_PREFIX } from '../src/private/consts.js';
import type { RequestBuilderOptions } from '../src/private/RequestBuilder.js';
import { buildRequestParams } from '../src/private/RequestBuilder.js';
import { AnthropicBeta, CacheTtl, COMPACT_BETA } from '../src/public/enums.js';
import type { AnyToolDefinition } from '../src/public/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal schema stub — only needs toJSONSchema for buildRequestParams. */
function mockSchema(jsonSchema: Record<string, unknown> = {}): AnyToolDefinition['input_schema'] {
  return {
    toJSONSchema: () => jsonSchema,
  } as unknown as AnyToolDefinition['input_schema'];
}

function makeTool(name: string, jsonSchema: Record<string, unknown> = {}): AnyToolDefinition {
  return {
    name,
    description: `${name} description`,
    input_schema: mockSchema(jsonSchema),
    input_examples: [],
    handler: async () => {},
  };
}

function makeOptions(overrides: Partial<RequestBuilderOptions> = {}): RequestBuilderOptions {
  return {
    model: 'claude-opus-4-5' as RequestBuilderOptions['model'],
    maxTokens: 1024,
    tools: [],
    ...overrides,
  };
}

function getContentCacheControl(messages: BetaMessageParam[], messageIndex = -1, blockIndex = -1) {
  const message = messages.at(messageIndex);
  if (message == null) {
    return undefined;
  }
  if (typeof message.content === 'string') {
    return undefined;
  }

  const block = message.content.at(blockIndex);
  if (block == null) {
    return undefined;
  }
  if (block.type === 'thinking' || block.type === 'redacted_thinking') {
    return undefined;
  }

  return block.cache_control ?? undefined;
}

const noMessages: Anthropic.Beta.Messages.BetaMessageParam[] = [];

// ---------------------------------------------------------------------------
// Base output shape
// ---------------------------------------------------------------------------

describe('buildRequestParams — base', () => {
  it('body.model matches options.model', () => {
    const expected = 'claude-opus-4-5';
    const actual = buildRequestParams(makeOptions({ model: expected as RequestBuilderOptions['model'] }), noMessages).body.model;
    expect(actual).toBe(expected);
  });

  it('body.max_tokens matches options.maxTokens', () => {
    const expected = 8192;
    const actual = buildRequestParams(makeOptions({ maxTokens: expected }), noMessages).body.max_tokens;
    expect(actual).toBe(expected);
  });

  it('body.stream is always true', () => {
    const expected = true;
    const actual = buildRequestParams(makeOptions(), noMessages).body.stream;
    expect(actual).toBe(expected);
  });

  it('context_management edits is not sent when no betas enabled', () => {
    const actual = buildRequestParams(makeOptions(), noMessages).body.context_management;
    expect(actual).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

describe('buildRequestParams — system prompts', () => {
  it('first system prompt is always AGENT_SDK_PREFIX', () => {
    const expected = AGENT_SDK_PREFIX;
    const system = buildRequestParams(makeOptions(), noMessages).body.system as { type: string; text: string }[];
    const actual = system[0]?.text;
    expect(actual).toBe(expected);
  });

  it('custom system prompts are appended after the prefix', () => {
    const expected = ['prefix', '\nsecond\n\nthird'];
    const system = buildRequestParams(makeOptions({ systemPrompts: ['second', 'third'] }), noMessages).body.system as { type: string; text: string }[];
    const actual = system.map((s) => (s.text === AGENT_SDK_PREFIX ? 'prefix' : s.text));
    expect(actual).toEqual(expected);
  });

  it('system prompt count is 1 without custom prompts', () => {
    const expected = 1;
    const system = buildRequestParams(makeOptions(), noMessages).body.system as unknown[];
    const actual = system.length;
    expect(actual).toBe(expected);
  });

  it('all system prompts have cache_control set to ephemeral', () => {
    const system = buildRequestParams(makeOptions({ systemPrompts: ['custom'] }), noMessages).body.system as { cache_control?: { type: string } }[];
    const actual = system.every((s) => s.cache_control?.type === 'ephemeral');
    expect(actual).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ContextManagement beta
// ---------------------------------------------------------------------------

describe('buildRequestParams — ContextManagement beta', () => {
  it('adds clear_thinking edit when ContextManagement is enabled', () => {
    const expected = 'clear_thinking_20251015';
    const { body } = buildRequestParams(makeOptions({ betas: { [AnthropicBeta.ContextManagement]: true } }), noMessages);
    const actual = body.context_management?.edits?.find((e) => e.type === 'clear_thinking_20251015')?.type;
    expect(actual).toBe(expected);
  });

  it('adds clear_tool_uses edit when ContextManagement is enabled', () => {
    const expected = 'clear_tool_uses_20250919';
    const { body } = buildRequestParams(makeOptions({ betas: { [AnthropicBeta.ContextManagement]: true } }), noMessages);
    const actual = body.context_management?.edits?.find((e) => e.type === 'clear_tool_uses_20250919')?.type;
    expect(actual).toBe(expected);
  });

  it('does not add clear_thinking edit when ContextManagement is disabled', () => {
    const expected = undefined;
    const { body } = buildRequestParams(makeOptions(), noMessages);
    const actual = body.context_management?.edits?.find((e) => e.type === 'clear_thinking_20251015');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Compact beta
// ---------------------------------------------------------------------------

describe('buildRequestParams — Compact beta', () => {
  it('adds compact_20260112 edit when compact is enabled', () => {
    const expected = 'compact_20260112';
    const { body } = buildRequestParams(makeOptions({ compact: { enabled: true, inputTokens: 160_000, pauseAfterCompaction: false } }), noMessages);
    const actual = body.context_management?.edits?.find((e) => e.type === 'compact_20260112')?.type;
    expect(actual).toBe(expected);
  });

  it('compact edit pause_after_compaction is false when configured false', () => {
    const expected = false;
    const { body } = buildRequestParams(makeOptions({ compact: { enabled: true, inputTokens: 160_000, pauseAfterCompaction: false } }), noMessages);
    const compactEdit = body.context_management?.edits?.find((e) => e.type === 'compact_20260112');
    const actual = (compactEdit as { pause_after_compaction?: boolean })?.pause_after_compaction;
    expect(actual).toBe(expected);
  });

  it('compact edit pause_after_compaction is true when configured true', () => {
    const expected = true;
    const { body } = buildRequestParams(makeOptions({ compact: { enabled: true, inputTokens: 160_000, pauseAfterCompaction: true } }), noMessages);
    const compactEdit = body.context_management?.edits?.find((e) => e.type === 'compact_20260112');
    const actual = (compactEdit as { pause_after_compaction?: boolean })?.pause_after_compaction;
    expect(actual).toBe(expected);
  });

  it('compact edit trigger.value matches inputTokens', () => {
    const expected = 50000;
    const { body } = buildRequestParams(makeOptions({ compact: { enabled: true, inputTokens: 50000, pauseAfterCompaction: false } }), noMessages);
    const compactEdit = body.context_management?.edits?.find((e) => e.type === 'compact_20260112');
    const actual = (compactEdit as { trigger?: { type: string; value: number } | null })?.trigger?.value;
    expect(actual).toBe(expected);
  });

  it('no compact edit when compact is not provided', () => {
    const { body } = buildRequestParams(makeOptions(), noMessages);
    const compactEdit = body.context_management?.edits?.find((e) => e.type === 'compact_20260112');
    const expected = undefined;
    const actual = compactEdit;
    expect(actual).toBe(expected);
  });

  it('no compact edit when compact.enabled is false', () => {
    const { body } = buildRequestParams(makeOptions({ compact: { enabled: false, inputTokens: 160_000, pauseAfterCompaction: false } }), noMessages);
    const compactEdit = body.context_management?.edits?.find((e) => e.type === 'compact_20260112');
    const expected = undefined;
    const actual = compactEdit;
    expect(actual).toBe(expected);
  });

  it('compact edit instructions defaults to null when not provided', () => {
    const expected = null;
    const { body } = buildRequestParams(makeOptions({ compact: { enabled: true, inputTokens: 160_000, pauseAfterCompaction: false } }), noMessages);
    const compactEdit = body.context_management?.edits?.find((e) => e.type === 'compact_20260112');
    const actual = (compactEdit as { instructions?: string | null })?.instructions;
    expect(actual).toBe(expected);
  });

  it('compact edit instructions matches customInstructions', () => {
    const expected = 'Summarize concisely';
    const { body } = buildRequestParams(makeOptions({ compact: { enabled: true, inputTokens: 160_000, pauseAfterCompaction: false, customInstructions: 'Summarize concisely' } }), noMessages);
    const compactEdit = body.context_management?.edits?.find((e) => e.type === 'compact_20260112');
    const actual = (compactEdit as { instructions?: string | null })?.instructions;
    expect(actual).toBe(expected);
  });

  it('compact beta header is included when compact is enabled', () => {
    const { headers } = buildRequestParams(makeOptions({ compact: { enabled: true, inputTokens: 160_000, pauseAfterCompaction: false } }), noMessages);
    const actual = headers['anthropic-beta'].includes(COMPACT_BETA);
    expect(actual).toBe(true);
  });

  it('compact beta header is not included when compact is disabled', () => {
    const { headers } = buildRequestParams(makeOptions({ compact: { enabled: false, inputTokens: 160_000, pauseAfterCompaction: false } }), noMessages);
    const actual = headers['anthropic-beta'].includes(COMPACT_BETA);
    expect(actual).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PromptCachingScope beta
// ---------------------------------------------------------------------------

describe('buildRequestParams — PromptCachingScope beta', () => {
  it('sets cache_control when PromptCachingScope is enabled', () => {
    const expected = 'ephemeral';
    const { body } = buildRequestParams(makeOptions({ betas: { [AnthropicBeta.PromptCachingScope]: true } }), noMessages);
    const actual = (body.cache_control as { type?: string } | undefined)?.type;
    expect(actual).toBe(expected);
  });

  it('cache_control is absent when PromptCachingScope is not enabled', () => {
    const expected = undefined;
    const { body } = buildRequestParams(makeOptions(), noMessages);
    const actual = body.cache_control;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Thinking
// ---------------------------------------------------------------------------

describe('buildRequestParams — thinking', () => {
  it('body.thinking is set to adaptive with summarized display when thinking is true', () => {
    const { body } = buildRequestParams(makeOptions({ thinking: true }), noMessages);
    const thinking = body.thinking as { type?: string; display?: string } | undefined;
    expect(thinking?.type).toBe('adaptive');
    expect(thinking?.display).toBe('summarized');
  });

  it('body.thinking is absent when thinking is not set', () => {
    const expected = undefined;
    const { body } = buildRequestParams(makeOptions(), noMessages);
    const actual = body.thinking;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

describe('buildRequestParams — headers', () => {
  it('anthropic-beta header is empty string when no betas are enabled', () => {
    const expected = '';
    const actual = buildRequestParams(makeOptions(), noMessages).headers['anthropic-beta'];
    expect(actual).toBe(expected);
  });

  it('anthropic-beta header contains the enabled beta', () => {
    const expected = AnthropicBeta.ClaudeCodeAuth;
    const actual = buildRequestParams(makeOptions({ betas: { [AnthropicBeta.ClaudeCodeAuth]: true } }), noMessages).headers['anthropic-beta'];
    expect(actual).toBe(expected);
  });

  it('anthropic-beta header contains all enabled betas comma-joined', () => {
    const { headers } = buildRequestParams(makeOptions({ betas: { [AnthropicBeta.ClaudeCodeAuth]: true, [AnthropicBeta.ContextManagement]: true } }), noMessages);
    const betas = headers['anthropic-beta'].split(',');
    const expected = true;
    const actual = betas.includes(AnthropicBeta.ClaudeCodeAuth) && betas.includes(AnthropicBeta.ContextManagement);
    expect(actual).toBe(expected);
  });

  it('disabled betas are excluded from the header', () => {
    const { headers } = buildRequestParams(makeOptions({ betas: { [AnthropicBeta.ClaudeCodeAuth]: true, [AnthropicBeta.ContextManagement]: false } }), noMessages);
    const expected = false;
    const actual = headers['anthropic-beta'].split(',').includes(AnthropicBeta.ContextManagement);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

describe('buildRequestParams — tools', () => {
  it('tool name is preserved in the mapped output', () => {
    const expected = 'my_tool';
    const { body } = buildRequestParams(makeOptions({ tools: [makeTool('my_tool')] }), noMessages);
    const actual = (body.tools as { name: string }[])[0]?.name;
    expect(actual).toBe(expected);
  });

  it('tool description is preserved in the mapped output', () => {
    const expected = 'my_tool description';
    const { body } = buildRequestParams(makeOptions({ tools: [makeTool('my_tool')] }), noMessages);
    const actual = (body.tools as { description: string }[])[0]?.description;
    expect(actual).toBe(expected);
  });

  it('tool input_schema comes from toJSONSchema', () => {
    const expected = { type: 'object', properties: { x: { type: 'number' } } };
    const tool = makeTool('t', expected);
    const { body } = buildRequestParams(makeOptions({ tools: [tool] }), noMessages);
    const actual = (body.tools as { input_schema: unknown }[])[0]?.input_schema;
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

describe('buildRequestParams — messages', () => {
  it('message text is preserved in body.messages', () => {
    const expected = 'hello';
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }];
    const { body } = buildRequestParams(makeOptions(), messages);
    const content = body.messages.at(0)?.content as { text: string }[];
    const actual = content.at(0)?.text;
    expect(actual).toBe(expected);
  });

  it('last user message in body has cache_control on its last content block', () => {
    const expected = { type: 'ephemeral', ttl: CacheTtl.OneHour };
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }];
    const { body } = buildRequestParams(makeOptions(), messages);
    const actual = getContentCacheControl(body.messages);
    expect(actual).toEqual(expected);
  });

  it('string content is wrapped in an array block with cache_control', () => {
    const expected = { type: 'ephemeral', ttl: CacheTtl.OneHour };
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: 'user', content: 'hello string' }];
    const { body } = buildRequestParams(makeOptions(), messages);
    const actual = getContentCacheControl(body.messages);
    expect(actual).toEqual(expected);
  });

  it('does not add cache_control when last user message has only thinking blocks', () => {
    const expected = undefined;
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: 'user', content: [{ type: 'thinking', thinking: 'hmm', signature: 'sig' }] }];
    const { body } = buildRequestParams(makeOptions(), messages);
    const actual = getContentCacheControl(body.messages);
    expect(actual).toBe(expected);
  });

  it('does not add cache_control when there are no user messages', () => {
    const expected = undefined;
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: 'assistant', content: [{ type: 'text', text: 'response' }] }];
    const { body } = buildRequestParams(makeOptions(), messages);
    const actual = getContentCacheControl(body.messages);
    expect(actual).toBe(expected);
  });

  it('last user message gets cache_control even when an assistant message follows it', () => {
    const expected = { type: 'ephemeral', ttl: CacheTtl.OneHour };
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: 'question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
    ];
    const { body } = buildRequestParams(makeOptions(), messages);
    const actual = getContentCacheControl(body.messages, 0);
    expect(actual).toEqual(expected);
  });

  it('assistant message does not get cache_control when only the user message should be cached', () => {
    const expected = undefined;
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: 'question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
    ];
    const { body } = buildRequestParams(makeOptions(), messages);
    const actual = getContentCacheControl(body.messages);
    expect(actual).toBe(expected);
  });

  it('last content block gets cache_control when there are multiple blocks', () => {
    const expected = { type: 'ephemeral', ttl: CacheTtl.OneHour };
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'last' },
        ],
      },
    ];
    const { body } = buildRequestParams(makeOptions(), messages);
    const actual = getContentCacheControl(body.messages);
    expect(actual).toEqual(expected);
  });

  it('earlier content blocks are not given cache_control when there are multiple blocks', () => {
    const expected = undefined;
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'last' },
        ],
      },
    ];
    const { body } = buildRequestParams(makeOptions(), messages);
    const actual = getContentCacheControl(body.messages, -1, 0);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// systemReminder
// ---------------------------------------------------------------------------

describe('buildRequestParams — systemReminder', () => {
  // buildRequestParams injects systemReminder unconditionally when provided.
  // QueryRunner is responsible for only passing it on the first call of a turn
  // (one-shot: set from options, cleared after the first API call).

  it('injects systemReminder as the last content block of the last user message', () => {
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }];
    const { body } = buildRequestParams(makeOptions({ systemReminder: 'stay focused' }), messages);
    const actual = (body.messages.at(-1)?.content as { type: string; text: string }[]).at(-1);
    const expected = { type: 'text', text: '<system-reminder>\nstay focused\n</system-reminder>' };
    expect(actual).toEqual(expected);
  });

  it('last content block is unchanged when systemReminder is not set', () => {
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }];
    const { body } = buildRequestParams(makeOptions({ systemReminder: undefined }), messages);
    const actual = (body.messages.at(-1)?.content as { type: string; text: string; cache_control?: unknown }[]).at(-1);
    const expected = { type: 'text', text: 'hello', cache_control: { type: 'ephemeral', ttl: CacheTtl.OneHour } };
    expect(actual).toEqual(expected);
  });
});
