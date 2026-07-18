import { describe, expect, it } from 'vitest';
import { buildEnvFrom } from '../src/exec-shared';

describe('buildEnvFrom', () => {
  it('sets a provided value when cmdEnv does not touch that key', () => {
    const actual = buildEnvFrom({ strip: [], provide: { GH_TOKEN: () => 'agent-token' } });
    expect(actual.GH_TOKEN).toBe('agent-token');
  });

  it('a caller-supplied cmdEnv value cannot override a provided identity key', () => {
    const actual = buildEnvFrom({ strip: [], provide: { GH_TOKEN: () => 'agent-token' } }, { GH_TOKEN: 'attacker-supplied' });
    expect(actual.GH_TOKEN).toBe('agent-token');
  });

  it('strips a stripped key even when cmdEnv tries to set it', () => {
    const actual = buildEnvFrom({ strip: ['GITHUB_TOKEN'], provide: {} }, { GITHUB_TOKEN: 'attacker-supplied' });
    expect(actual.GITHUB_TOKEN).toBeUndefined();
  });

  it('keeps a cmdEnv value for a key the provider does not touch', () => {
    const actual = buildEnvFrom({ strip: [], provide: {} }, { NODE_ENV: 'production' });
    expect(actual.NODE_ENV).toBe('production');
  });

  it('resolves each provide value fresh on every call, not cached across calls', () => {
    let calls = 0;
    const config = { strip: [], provide: { GH_TOKEN: () => `token-${++calls}` } };
    buildEnvFrom(config);
    const actual = buildEnvFrom(config).GH_TOKEN;
    expect(actual).toBe('token-2');
  });
});
