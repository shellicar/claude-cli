import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import type { ThinkingEffort } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import type { CacheParameters } from '../src/model/ModelSettings.js';
import { StatusState } from '../src/model/StatusState.js';
import { IRuntimeOptions } from '../src/setup/IRuntimeOptions.js';
import { ModelOverrides } from '../src/setup/ModelOverrides.js';

const CONFIG_MODEL = 'claude-sonnet-4-5';

type ConfigDefaults = { model?: string; thinkingEnabled?: boolean; effort?: ThinkingEffort };

function build(modelFlag: string | null = null, defaults: ConfigDefaults = {}): ModelOverrides {
  const config = {
    model: defaults.model ?? CONFIG_MODEL,
    thinking: { enabled: defaults.thinkingEnabled ?? false, effort: defaults.effort },
  };
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(IRuntimeOptions)
    .using(() => ({ modelOverride: modelFlag, systemFlagText: null, claudeMdFlagText: null, tsAvailable: false }) satisfies IRuntimeOptions)
    .asSelf();
  services
    .register(StatusState)
    .using(() => new StatusState('test'))
    .asSelf();
  services
    .register(ConfigLoader)
    .using(() => ({ config }) as unknown as ConfigLoader<any>)
    .asSelf();
  services.register(ModelOverrides).asSelf();
  return services.buildProvider().resolve(ModelOverrides);
}

function sent(fields: Partial<CacheParameters> = {}): CacheParameters {
  return { model: fields.model ?? CONFIG_MODEL, thinking: fields.thinking ?? false, effort: fields.effort ?? null };
}

describe('ModelOverrides — what a conversation resumes on', () => {
  it('comes up on the model its cached prefix was written under', () => {
    const overrides = build();

    overrides.adopt(sent({ model: 'claude-opus-4-8' }));

    const expected = 'claude-opus-4-8';
    const actual = overrides.model;

    expect(actual).toBe(expected);
  });

  it('comes up on the effort its cached prefix was written under', () => {
    const overrides = build();

    overrides.adopt(sent({ effort: 'high' }));

    const expected = 'high';
    const actual = overrides.effort;

    expect(actual).toBe(expected);
  });

  it('comes up on the thinking its cached prefix was written under', () => {
    const overrides = build(null, { thinkingEnabled: false });

    overrides.adopt(sent({ thinking: true }));

    const expected = 'on';
    const actual = overrides.thinking;

    expect(actual).toBe(expected);
  });

  it('reports no model override when the cached model is the one the config already names', () => {
    const overrides = build();

    overrides.adopt(sent({ model: CONFIG_MODEL }));

    const expected = null;
    const actual = overrides.model;

    expect(actual).toBe(expected);
  });

  it('reports no effort override when the cached effort is the one the config already names', () => {
    const overrides = build(null, { effort: 'high' });

    overrides.adopt(sent({ effort: 'high' }));

    const expected = null;
    const actual = overrides.effort;

    expect(actual).toBe(expected);
  });

  it('holds no override for a conversation that has sent nothing', () => {
    const overrides = build();

    overrides.adopt(null);

    const expected = null;
    const actual = overrides.model;

    expect(actual).toBe(expected);
  });

  it('drops a runtime change made against the conversation being left', () => {
    const overrides = build();
    overrides.setModel('claude-haiku-4-5');

    overrides.adopt(sent({ model: 'claude-opus-4-8' }));

    const expected = 'claude-opus-4-8';
    const actual = overrides.model;

    expect(actual).toBe(expected);
  });
});

describe('ModelOverrides — precedence', () => {
  it('prefers the launch flag over what the conversation last sent', () => {
    const overrides = build('claude-haiku-4-5');

    overrides.adopt(sent({ model: 'claude-opus-4-8' }));

    const expected = 'claude-haiku-4-5';
    const actual = overrides.model;

    expect(actual).toBe(expected);
  });

  it('prefers a runtime change over the launch flag, so the operator can clear a divergence', () => {
    const overrides = build('claude-haiku-4-5');

    overrides.setModel('claude-opus-4-8');

    const expected = 'claude-opus-4-8';
    const actual = overrides.model;

    expect(actual).toBe(expected);
  });

  it('advances effort from the value the conversation came up on, not from the head of the cycle', () => {
    const overrides = build();
    overrides.adopt(sent({ effort: 'medium' }));

    overrides.cycleEffort();

    const expected = 'high';
    const actual = overrides.effort;

    expect(actual).toBe(expected);
  });
});

describe('ModelOverrides — what the cached prefix was written under', () => {
  it('holds nothing before the conversation has sent anything', () => {
    const overrides = build();

    const actual = overrides.cached;

    expect(actual).toBeNull();
  });

  it('holds the parameters the last request was sent with', () => {
    const overrides = build();

    overrides.markSent(sent({ model: 'claude-opus-4-8', thinking: true, effort: 'max' }));

    const expected = { model: 'claude-opus-4-8', thinking: true, effort: 'max' };
    const actual = overrides.cached;

    expect(actual).toEqual(expected);
  });

  it('holds nothing for a new conversation, which has no cached prefix to lose', () => {
    const overrides = build();
    overrides.markSent(sent({ model: 'claude-opus-4-8' }));

    overrides.carryOver();

    const actual = overrides.cached;

    expect(actual).toBeNull();
  });

  it('keeps the operator selection when a new conversation carries it over', () => {
    const overrides = build();
    overrides.setModel('claude-opus-4-8');

    overrides.carryOver();

    const expected = 'claude-opus-4-8';
    const actual = overrides.model;

    expect(actual).toBe(expected);
  });
});
