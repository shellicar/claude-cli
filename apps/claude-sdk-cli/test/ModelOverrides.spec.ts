import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { StatusState } from '../src/model/StatusState.js';
import { IRuntimeOptions } from '../src/setup/IRuntimeOptions.js';
import { ModelOverrides } from '../src/setup/ModelOverrides.js';
import { MemoryObjectStore } from './MemoryObjectStore.js';

const CONFIG_MODEL = 'claude-sonnet-4-5';

function build(modelFlag: string | null = null): { overrides: ModelOverrides; objects: MemoryObjectStore } {
  const objects = new MemoryObjectStore();
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
    .using(() => ({ config: { model: CONFIG_MODEL } }) as unknown as ConfigLoader<any>)
    .asSelf();
  services
    .register(IObjectStore)
    .using(() => objects)
    .asSelf();
  services.register(ModelOverrides).asSelf();
  return { overrides: services.buildProvider().resolve(ModelOverrides), objects };
}

describe('ModelOverrides — what a conversation resumes on', () => {
  it('restores the model the conversation last made a request under', () => {
    const { overrides } = build();
    overrides.setModel('claude-opus-4-8');
    overrides.record('conversation-a');
    overrides.load('conversation-a');

    const expected = 'claude-opus-4-8';
    const actual = overrides.model;

    expect(actual).toBe(expected);
  });

  it('restores the effort the conversation last made a request under', () => {
    const { overrides } = build();
    overrides.cycleEffort();
    overrides.record('conversation-a');
    overrides.load('conversation-a');

    const expected = 'low';
    const actual = overrides.effort;

    expect(actual).toBe(expected);
  });

  it('restores nothing for a conversation that has never made a request', () => {
    const { overrides } = build();

    overrides.load('never-used');

    const expected = null;
    const actual = overrides.model;

    expect(actual).toBe(expected);
  });

  it('drops a runtime change made against the conversation being left', () => {
    const { overrides } = build();
    overrides.setModel('claude-opus-4-8');
    overrides.record('conversation-a');
    overrides.setModel('claude-haiku-4-5');

    overrides.load('conversation-a');

    const expected = 'claude-opus-4-8';
    const actual = overrides.model;

    expect(actual).toBe(expected);
  });
});

describe('ModelOverrides — precedence', () => {
  it('prefers the launch flag over what the conversation last used', () => {
    const { overrides } = build('claude-haiku-4-5');
    overrides.setModel('claude-opus-4-8');
    overrides.record('conversation-a');

    overrides.load('conversation-a');

    const expected = 'claude-haiku-4-5';
    const actual = overrides.model;

    expect(actual).toBe(expected);
  });

  it('prefers a runtime change over the launch flag, so the operator can clear a divergence', () => {
    const { overrides } = build('claude-haiku-4-5');
    overrides.setModel('claude-opus-4-8');

    const expected = 'claude-opus-4-8';
    const actual = overrides.model;

    expect(actual).toBe(expected);
  });

  it('advances effort from the value the conversation restored, not from the head of the cycle', () => {
    const { overrides } = build();
    overrides.cycleEffort();
    overrides.cycleEffort();
    overrides.record('conversation-a');
    overrides.load('conversation-a');

    overrides.cycleEffort();

    const expected = 'high';
    const actual = overrides.effort;

    expect(actual).toBe(expected);
  });
});

describe('ModelOverrides — what the cached prefix was written under', () => {
  it('reports nothing recorded before the conversation has made a request', () => {
    const { overrides } = build();

    const actual = overrides.recorded;

    expect(actual).toBeNull();
  });

  it('reports the settings the last request was made under', () => {
    const { overrides } = build();
    overrides.setModel('claude-opus-4-8');
    overrides.cycleThinking();

    overrides.record('conversation-a');

    const expected = { model: 'claude-opus-4-8', thinking: 'on', effort: null };
    const actual = overrides.recorded;

    expect(actual).toEqual(expected);
  });

  it('reports nothing recorded for a new conversation, which has no cached prefix to lose', () => {
    const { overrides } = build();
    overrides.setModel('claude-opus-4-8');
    overrides.record('conversation-a');

    overrides.inherit();

    const actual = overrides.recorded;

    expect(actual).toBeNull();
  });

  it('keeps the operator selection when a new conversation inherits it', () => {
    const { overrides } = build();
    overrides.setModel('claude-opus-4-8');
    overrides.record('conversation-a');

    overrides.inherit();

    const expected = 'claude-opus-4-8';
    const actual = overrides.model;

    expect(actual).toBe(expected);
  });
});
