import { describe, expect, it } from 'vitest';
import type { ResolvedSdkConfig } from '../src/cli-config/types.js';
import { formatEffectiveConfig } from '../src/cli-config/formatEffectiveConfig.js';

describe('formatEffectiveConfig', () => {
  it('includes the effective model in the output', () => {
    const config = { model: 'claude-opus-4-6', maxTokens: 8000 } as unknown as ResolvedSdkConfig;
    const actual = formatEffectiveConfig(config);
    expect(actual).toContain('claude-opus-4-6');
  });

  it('renders the config as pretty JSON', () => {
    const config = { model: 'claude-opus-4-6', maxTokens: 8000 } as unknown as ResolvedSdkConfig;
    const actual = formatEffectiveConfig(config);
    expect(actual).toContain('"maxTokens": 8000');
  });
});
