import { IDurableConfigProvider } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import type { AuditDerivation } from '../src/AuditStats.js';
import type { CacheParameters } from '../src/model/ModelSettings.js';
import { ModelSettings } from '../src/model/ModelSettings.js';
import { StatusState } from '../src/model/StatusState.js';
import { CacheWarning, ICacheWarning } from '../src/setup/CacheWarning.js';
import { FakeModelSettings } from './FakeModelSettings.js';

const MODEL = 'claude-fable-5';

// `effort` is read by presence, not by ??, so a deliberate null reaches the subject as the model
// default rather than being swallowed back into the fallback.
function parameters(fields: Partial<CacheParameters> = {}): CacheParameters {
  return { model: fields.model ?? MODEL, thinking: fields.thinking ?? true, effort: 'effort' in fields ? (fields.effort ?? null) : 'low' };
}

/** The live settings a request would go out under right now, held by the config provider the
 *  warning reads through. */
function build(live: CacheParameters, contextTokens = 0): { warning: ICacheWarning; settings: FakeModelSettings; status: StatusState } {
  const settings = new FakeModelSettings();
  const status = new StatusState('test');
  status.resetTo({ inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0, lastContextUsed: contextTokens, contextWindow: 1_000_000 });
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(IDurableConfigProvider)
    .using(
      () =>
        ({
          getEffectiveModel: () => live.model,
          getEffectiveThinkingEnabled: () => live.thinking,
          getEffectiveEffort: () => live.effort ?? undefined,
        }) as unknown as IDurableConfigProvider,
    )
    .asSelf();
  services
    .register(ModelSettings)
    .using(() => settings)
    .asSelf();
  services
    .register(StatusState)
    .using(() => status)
    .asSelf();
  services.register(CacheWarning).as(ICacheWarning);
  return { warning: services.buildProvider().resolve(ICacheWarning), settings, status };
}

describe('CacheWarning — when there is nothing to warn about', () => {
  it('says nothing for a conversation that has sent nothing', () => {
    const { warning, status } = build(parameters());

    warning.refresh();

    const actual = status.cacheDivergence;

    expect(actual).toBeNull();
  });

  it('says nothing while the live settings still match what was sent', () => {
    const { warning, settings, status } = build(parameters());
    settings.adopt(parameters());

    warning.refresh();

    const actual = status.cacheDivergence;

    expect(actual).toBeNull();
  });

  it('stops warning once a request goes out under the new settings', () => {
    const { warning, settings, status } = build(parameters({ effort: 'max' }));
    settings.adopt(parameters({ effort: 'low' }));
    warning.refresh();

    settings.markSent(parameters({ effort: 'max' }));
    warning.refresh();

    const actual = status.cacheDivergence;

    expect(actual).toBeNull();
  });
});

describe('CacheWarning — what has moved', () => {
  it('names the effort that has moved away from the cached one', () => {
    const { warning, settings, status } = build(parameters({ effort: 'max' }));
    settings.adopt(parameters({ effort: 'low' }));

    warning.refresh();

    const expected = [{ name: 'effort', from: 'low', to: 'max' }];
    const actual = status.cacheDivergence?.changes;

    expect(actual).toEqual(expected);
  });

  it('names the model that has moved away from the cached one', () => {
    const { warning, settings, status } = build(parameters({ model: 'claude-opus-4-8' }));
    settings.adopt(parameters({ model: MODEL }));

    warning.refresh();

    const expected = [{ name: 'model', from: MODEL, to: 'claude-opus-4-8' }];
    const actual = status.cacheDivergence?.changes;

    expect(actual).toEqual(expected);
  });

  it('reads thinking as on and off rather than as a boolean', () => {
    const { warning, settings, status } = build(parameters({ thinking: false }));
    settings.adopt(parameters({ thinking: true }));

    warning.refresh();

    const expected = [{ name: 'thinking', from: 'on', to: 'off' }];
    const actual = status.cacheDivergence?.changes;

    expect(actual).toEqual(expected);
  });

  it('reads an absent effort as the model default rather than as nothing', () => {
    const { warning, settings, status } = build(parameters({ effort: null }));
    settings.adopt(parameters({ effort: 'low' }));

    warning.refresh();

    const expected = 'default';
    const actual = status.cacheDivergence?.changes[0]?.to;

    expect(actual).toBe(expected);
  });

  it('names every parameter that has moved, not just the first', () => {
    const { warning, settings, status } = build(parameters({ model: 'claude-opus-4-8', thinking: false, effort: 'max' }));
    settings.adopt(parameters({ model: MODEL, thinking: true, effort: 'low' }));

    warning.refresh();

    const expected = ['model', 'thinking', 'effort'];
    const actual = status.cacheDivergence?.changes.map((change) => change.name);

    expect(actual).toEqual(expected);
  });
});

describe('CacheWarning — what it would cost', () => {
  it('counts the whole of the last request context as the prefix that would be re-written', () => {
    const { warning, settings, status } = build(parameters({ effort: 'max' }), 250_000);
    settings.adopt(parameters({ effort: 'low' }));

    warning.refresh();

    const expected = 250_000;
    const actual = status.cacheDivergence?.tokens;

    expect(actual).toBe(expected);
  });

  it('prices that prefix at the one-hour cache write rate of the model the next request would use', () => {
    // claude-fable-5 writes a 1h cache at $20/M, so a million tokens is $20.
    const { warning, settings, status } = build(parameters({ effort: 'max' }), 1_000_000);
    settings.adopt(parameters({ effort: 'low' }));

    warning.refresh();

    const expected = 20;
    const actual = status.cacheDivergence?.costUsd;

    expect(actual).toBe(expected);
  });
});

describe('CacheWarning — what a conversation is measured against when it is adopted', () => {
  const derivation = (fields: Partial<AuditDerivation>): AuditDerivation => ({ totals: {}, cached: fields.cached ?? null, lastModel: fields.lastModel ?? null }) as AuditDerivation;

  it('uses what the audit recorded when the audit recorded it', () => {
    const { warning } = build(parameters({ effort: 'max' }));
    const audit = derivation({ cached: parameters({ effort: 'low' }), lastModel: MODEL });

    const expected = 'low';
    const actual = warning.baselineFor(audit)?.effort;

    expect(actual).toBe(expected);
  });

  it('assumes the live effort for a conversation whose turns predate the recording', () => {
    const { warning } = build(parameters({ effort: 'max' }));
    const audit = derivation({ cached: null, lastModel: MODEL });

    const expected = 'max';
    const actual = warning.baselineFor(audit)?.effort;

    expect(actual).toBe(expected);
  });

  it('takes the model from the audit rather than assuming it, since every line carries one', () => {
    const { warning } = build(parameters({ model: 'claude-haiku-4-5' }));
    const audit = derivation({ cached: null, lastModel: 'claude-opus-4-8' });

    const expected = 'claude-opus-4-8';
    const actual = warning.baselineFor(audit)?.model;

    expect(actual).toBe(expected);
  });

  it('measures nothing for a conversation that has sent nothing, which has no prefix to lose', () => {
    const { warning } = build(parameters());
    const audit = derivation({ cached: null, lastModel: null });

    const actual = warning.baselineFor(audit);

    expect(actual).toBeNull();
  });
});
