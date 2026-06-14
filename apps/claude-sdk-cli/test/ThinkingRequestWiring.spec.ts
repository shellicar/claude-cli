import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStream } from '@anthropic-ai/sdk/lib/BetaMessageStream.mjs';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IConfigFileReader } from '@shellicar/claude-core/Config/interfaces';
import { Conversation, IMessageStreamer, StreamProcessor, type ThinkingEffort, TurnRunner } from '@shellicar/claude-sdk';
import { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { describe, expect, it } from 'vitest';
import { sdkConfigSchema } from '../src/cli-config/schema.js';
import { StatusState } from '../src/model/StatusState.js';
import type { AppToolsService } from '../src/setup/AppToolsService.js';
import { DurableConfigFactory } from '../src/setup/DurableConfigFactory.js';
import { ModelOverrides } from '../src/setup/ModelOverrides.js';
import { SystemPromptLoader } from '../src/SystemPromptLoader.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

// Reads one in-memory source; the loader parses + applies schema defaults.
class FakeConfigFileReader extends IConfigFileReader {
  readonly #json: string;
  public constructor(json: string) {
    super();
    this.#json = json;
  }
  public exists(_path: string): boolean {
    return true;
  }
  public read(_path: string): string {
    return this.#json;
  }
}

// Non-retryable, so TurnRunner.run rejects after one stream() call.
class CaptureAndStop extends Error {}

// Records the assembled body, then aborts the turn — we only want the request.
class FakeMessageStreamer extends IMessageStreamer {
  public readonly bodies: BetaMessageStreamParams[] = [];
  public stream(body: BetaMessageStreamParams, _options: Anthropic.RequestOptions): BetaMessageStream {
    this.bodies.push(body);
    throw new CaptureAndStop();
  }
}

type ThinkingConfig = { enabled: boolean; effort: ThinkingEffort };
type Override = 'on' | 'off' | null;

// Real ConfigLoader, fake reader, real schema — the class's designed test path
// (mirrors packages/claude-core/test/ConfigLoader.spec.ts). Only `thinking` is
// specified; the schema fills every other field's default.
function makeLoader(thinking: ThinkingConfig): ConfigLoader<typeof sdkConfigSchema> {
  const reader = new FakeConfigFileReader(JSON.stringify({ thinking }));
  const loader = new ConfigLoader({ schema: sdkConfigSchema, paths: ['/sdk-config.json'], reader, fs: new MemoryFileSystem({}, '/home', '/project') });
  loader.load();
  return loader;
}

// ModelOverrides has no setter; THINKING_CYCLE = [null, 'on', 'off'].
function makeFactory(thinking: ThinkingConfig, override: Override): DurableConfigFactory {
  const fs = new MemoryFileSystem({}, '/home', '/project');
  const overrides = new ModelOverrides(null, new StatusState(fs));
  if (override === 'on') {
    overrides.cycleThinking();
  } else if (override === 'off') {
    overrides.cycleThinking();
    overrides.cycleThinking();
  }
  const appTools = { tools: [], store: new RefStore(), refTransform: (_name: string, output: unknown) => output } satisfies AppToolsService;
  return new DurableConfigFactory(makeLoader(thinking), overrides, appTools, new SystemPromptLoader(fs), null);
}

// Drives the wired path and returns the body the runner sent to the streamer.
async function buildBody(factory: DurableConfigFactory): Promise<BetaMessageStreamParams> {
  const streamer = new FakeMessageStreamer();
  const runner = new TurnRunner(streamer, new StreamProcessor());
  const conv = new Conversation();
  conv.push({ role: 'user', content: 'hi' });
  await runner.run(conv, factory.config, { abortSignal: new AbortController().signal }).catch(() => {});
  const body = streamer.bodies[0];
  if (body == null) {
    throw new Error('no request body captured');
  }
  return body;
}

describe('thinking resolution → request body (wired)', () => {
  // Scenario 1: enabled, effort E, no override.
  it('enabled config sends adaptive thinking', async () => {
    const expected = { type: 'adaptive', display: 'summarized' };
    const factory = makeFactory({ enabled: true, effort: 'high' }, null);

    const actual = (await buildBody(factory)).thinking;

    expect(actual).toEqual(expected);
  });

  it('enabled config sends output_config.effort from config', async () => {
    const expected = 'high';
    const factory = makeFactory({ enabled: true, effort: 'high' }, null);

    const actual = (await buildBody(factory)).output_config?.effort;

    expect(actual).toBe(expected);
  });

  // Scenario 2: disabled, no override.
  it('disabled config sends disabled thinking', async () => {
    const expected = { type: 'disabled' };
    const factory = makeFactory({ enabled: false, effort: 'high' }, null);

    const actual = (await buildBody(factory)).thinking;

    expect(actual).toEqual(expected);
  });

  it('disabled config omits output_config', async () => {
    const factory = makeFactory({ enabled: false, effort: 'high' }, null);

    const actual = (await buildBody(factory)).output_config;

    expect(actual).toBeUndefined();
  });

  // Scenario 3: override off over enabled config → same as disabled.
  it('session override off disables over enabled config', async () => {
    const expected = { type: 'disabled' };
    const factory = makeFactory({ enabled: true, effort: 'high' }, 'off');

    const actual = (await buildBody(factory)).thinking;

    expect(actual).toEqual(expected);
  });

  // Scenario 4: override on over disabled config → same as enabled.
  it('session override on enables over disabled config', async () => {
    const expected = { type: 'adaptive', display: 'summarized' };
    const factory = makeFactory({ enabled: false, effort: 'high' }, 'on');

    const actual = (await buildBody(factory)).thinking;

    expect(actual).toEqual(expected);
  });

  // Scenario 5: effort flows when enabled (E2 distinct from above).
  it('effort flows from config when enabled', async () => {
    const expected = 'medium';
    const factory = makeFactory({ enabled: true, effort: 'medium' }, null);

    const actual = (await buildBody(factory)).output_config?.effort;

    expect(actual).toBe(expected);
  });
});
