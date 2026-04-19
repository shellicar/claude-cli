import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta.mjs';
import { describe, expect, it } from 'vitest';
import { buildAtuTransform } from '../src/buildAtuTransform.js';

const baseConfig = {
  enabled: false,
  allowProgrammaticExecution: [],
  codeExecutionTool: 'code_execution_20260120',
};

function makeTool(extra: Record<string, unknown> = {}): BetaToolUnion {
  return {
    name: 'my_tool',
    description: 'my tool',
    input_schema: { type: 'object' as const, properties: {} },
    input_examples: [{ x: 1 }],
    ...extra,
  } as unknown as BetaToolUnion;
}

// ---------------------------------------------------------------------------
// ATU disabled
// ---------------------------------------------------------------------------

describe('buildAtuTransform — ATU disabled', () => {
  it('strips input_examples from the wire tool', () => {
    const expected = undefined;
    const transform = buildAtuTransform([], { ...baseConfig, enabled: false });
    const actual = (transform(makeTool()) as { input_examples?: unknown }).input_examples;
    expect(actual).toBe(expected);
  });

  it('preserves the tool name', () => {
    const expected = 'my_tool';
    const transform = buildAtuTransform([], { ...baseConfig, enabled: false });
    const actual = (transform(makeTool()) as { name: string }).name;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ATU enabled
// ---------------------------------------------------------------------------

describe('buildAtuTransform — ATU enabled', () => {
  it('keeps input_examples in the wire tool', () => {
    const expected = [{ x: 1 }];
    const transform = buildAtuTransform([], { ...baseConfig, enabled: true });
    const actual = (transform(makeTool()) as { input_examples?: unknown }).input_examples;
    expect(actual).toEqual(expected);
  });

  it('preserves the tool name', () => {
    const expected = 'my_tool';
    const transform = buildAtuTransform([], { ...baseConfig, enabled: true });
    const actual = (transform(makeTool()) as { name: string }).name;
    expect(actual).toBe(expected);
  });
});
