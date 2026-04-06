import type { Anthropic } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AGENT_SDK_PREFIX } from '../src/private/consts.js';
import { buildRequestParams } from '../src/private/RequestBuilder.js';
import { AnthropicBeta } from '../src/public/enums.js';
import type { AnyToolDefinition, RunAgentQuery } from '../src/public/types.js';

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

function makeOptions(overrides: Partial<RunAgentQuery> = {}): RunAgentQuery {
  return {
    model: 'claude-opus-4-5' as RunAgentQuery['model'],
    maxTokens: 1024,
    messages: [],
    tools: [],
    ...overrides,
  };
}

const noMessages: Anthropic.Beta.Messages.BetaMessageParam[] = [];

// ---------------------------------------------------------------------------
// Base output shape
// ---------------------------------------------------------------------------

describe('buildRequestParams — base', () => {
  it('body.model matches options.model', () => {
    const expected = 'claude-opus-4-5';
    const actual = buildRequestParams(makeOptions({ model: expected as RunAgentQuery['model'] }), noMessages).body.model;
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

  it('context_management edits are empty when no betas enabled', () => {
    const expected = 0;
    const actual = buildRequestParams(makeOptions(), noMessages).body.context_management?.edits?.length;
    expect(actual).toBe(expected);
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
    const expected = ['prefix', 'second', 'third'];
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
  it('adds compact_20260112 edit when Compact is enabled', () => {
    const expected = 'compact_20260112';
    const { body } = buildRequestParams(makeOptions({ betas: { [AnthropicBeta.Compact]: true } }), noMessages);
    const actual = body.context_management?.edits?.find((e) => e.type === 'compact_20260112')?.type;
    expect(actual).toBe(expected);
  });

  it('compact edit pause_after_compaction defaults to false', () => {
    const expected = false;
    const { body } = buildRequestParams(makeOptions({ betas: { [AnthropicBeta.Compact]: true } }), noMessages);
    const compactEdit = body.context_management?.edits?.find((e) => e.type === 'compact_20260112');
    const actual = (compactEdit as { pause_after_compaction?: boolean })?.pause_after_compaction;
    expect(actual).toBe(expected);
  });

  it('compact edit pause_after_compaction is true when pauseAfterCompact is set', () => {
    const expected = true;
    const { body } = buildRequestParams(makeOptions({ betas: { [AnthropicBeta.Compact]: true }, pauseAfterCompact: true }), noMessages);
    const compactEdit = body.context_management?.edits?.find((e) => e.type === 'compact_20260112');
    const actual = (compactEdit as { pause_after_compaction?: boolean })?.pause_after_compaction;
    expect(actual).toBe(expected);
  });

  it('compact edit trigger is null when compactInputTokens is not set', () => {
    const expected = null;
    const { body } = buildRequestParams(makeOptions({ betas: { [AnthropicBeta.Compact]: true } }), noMessages);
    const compactEdit = body.context_management?.edits?.find((e) => e.type === 'compact_20260112');
    const actual = (compactEdit as { trigger?: unknown })?.trigger;
    expect(actual).toBe(expected);
  });

  it('compact edit trigger.value matches compactInputTokens', () => {
    const expected = 50000;
    const { body } = buildRequestParams(makeOptions({ betas: { [AnthropicBeta.Compact]: true }, compactInputTokens: 50000 }), noMessages);
    const compactEdit = body.context_management?.edits?.find((e) => e.type === 'compact_20260112');
    const actual = (compactEdit as { trigger?: { type: string; value: number } | null })?.trigger?.value;
    expect(actual).toBe(expected);
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
  it('body.thinking is set to adaptive when thinking is true', () => {
    const expected = 'adaptive';
    const { body } = buildRequestParams(makeOptions({ thinking: true }), noMessages);
    const actual = (body.thinking as { type?: string } | undefined)?.type;
    expect(actual).toBe(expected);
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
    const expected = AnthropicBeta.Compact;
    const actual = buildRequestParams(makeOptions({ betas: { [AnthropicBeta.Compact]: true } }), noMessages).headers['anthropic-beta'];
    expect(actual).toBe(expected);
  });

  it('anthropic-beta header contains all enabled betas comma-joined', () => {
    const { headers } = buildRequestParams(makeOptions({ betas: { [AnthropicBeta.Compact]: true, [AnthropicBeta.ContextManagement]: true } }), noMessages);
    const betas = headers['anthropic-beta'].split(',');
    const expected = true;
    const actual = betas.includes(AnthropicBeta.Compact) && betas.includes(AnthropicBeta.ContextManagement);
    expect(actual).toBe(expected);
  });

  it('disabled betas are excluded from the header', () => {
    const { headers } = buildRequestParams(makeOptions({ betas: { [AnthropicBeta.Compact]: true, [AnthropicBeta.ContextManagement]: false } }), noMessages);
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
  it('messages array is passed through to body.messages', () => {
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }];
    const expected = messages;
    const actual = buildRequestParams(makeOptions(), messages).body.messages;
    expect(actual).toBe(expected);
  });
});
