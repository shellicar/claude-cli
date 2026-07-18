import { describe, expect, it } from 'vitest';
import { formatEffectiveConfig, pickOverriddenConfig } from '../src/cli-config/formatEffectiveConfig.js';
import type { ResolvedSdkConfig } from '../src/cli-config/types.js';

describe('formatEffectiveConfig', () => {
  it('includes the effective model in the output when --config named it', () => {
    const config = { model: 'claude-opus-4-6', maxTokens: 8000 } as unknown as ResolvedSdkConfig;
    const actual = formatEffectiveConfig(config, { model: 'claude-opus-4-6' });
    expect(actual).toContain('claude-opus-4-6');
  });

  it('renders the config as compact JSON', () => {
    const config = { model: 'claude-opus-4-6', maxTokens: 8000 } as unknown as ResolvedSdkConfig;
    const actual = formatEffectiveConfig(config, { maxTokens: 8000 });
    expect(actual).toContain('"maxTokens":8000');
  });

  it('omits a key --config did not name', () => {
    const config = { model: 'claude-opus-4-6', maxTokens: 8000 } as unknown as ResolvedSdkConfig;
    const actual = formatEffectiveConfig(config, { maxTokens: 8000 });
    expect(actual).not.toContain('claude-opus-4-6');
  });
});

describe('pickOverriddenConfig', () => {
  it('keeps a top-level key that --config named', () => {
    const actual = pickOverriddenConfig({ maxTokens: 8000 }, { maxTokens: 120000 });
    expect(actual).toEqual({ maxTokens: 8000 });
  });

  it('drops a key --config named that the schema does not recognise', () => {
    const actual = pickOverriddenConfig({ maxTokens: 8000 }, { x: 5 });
    expect(actual).toEqual({});
  });

  it('drops a key the config has but --config did not name', () => {
    const actual = pickOverriddenConfig({ maxTokens: 8000, model: 'claude-opus-4-6' }, { maxTokens: 8000 });
    expect(actual).not.toHaveProperty('model');
  });

  it('recurses into a nested object so a partial override only surfaces the named field', () => {
    const actual = pickOverriddenConfig({ hooks: { approvalNotify: { command: 'foo', enabled: true } } }, { hooks: { approvalNotify: { command: 'bar' } } });
    expect(actual).toEqual({ hooks: { approvalNotify: { command: 'foo' } } });
  });
});
