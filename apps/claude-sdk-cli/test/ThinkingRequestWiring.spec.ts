import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStream } from '@anthropic-ai/sdk/lib/BetaMessageStream.mjs';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import { Clock, Instant, ZoneId } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IConfigFileReader } from '@shellicar/claude-core/Config/interfaces';
import { readConfig } from '@shellicar/claude-core/Config/readConfig';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IRandomProvider } from '@shellicar/claude-core/providers/IRandomProvider';
import { ISleepProvider } from '@shellicar/claude-core/providers/ISleepProvider';
import { AccountLimitListener, Conversation, type DurableConfig, IDurableConfigProvider, IMessageStreamer, IRequestClockListener, IStreamProcessor, IToolRegistry, IWakeLock, StreamInterruptListener, StreamProcessor, type ThinkingEffort, ToolRegistry, TurnRunner, type WakeLockHandle } from '@shellicar/claude-sdk';
import { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { sdkConfigSchema } from '../src/cli-config/schema.js';
import { StatusState } from '../src/model/StatusState.js';
import { SystemPromptLoader } from '../src/SystemPromptLoader.js';
import { AppToolsService } from '../src/setup/AppToolsService.js';
import { DurableConfigFactory } from '../src/setup/DurableConfigFactory.js';
import { IRuntimeOptions } from '../src/setup/IRuntimeOptions.js';
import { ModelOverrides } from '../src/setup/ModelOverrides.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';
import { MemoryObjectStore } from './MemoryObjectStore.js';

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

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

class NoopAccountLimitListener extends AccountLimitListener {
  public retrying(): void {}
  public stopped(): void {}
}

class NoopWakeLock extends IWakeLock {
  public acquire(): WakeLockHandle {
    return { release: () => {} };
  }
}

class NoopInterruption extends StreamInterruptListener {
  public reconnecting(): void {}
}

class NoopRequestClock extends IRequestClockListener {
  public requestStarted(): void {}
  public requestSettled(_kept: boolean): void {}
}

// StreamProcessor @dependsOn(IDurableConfigProvider) to price the usage frames it emits. This wiring
// captures the request and aborts before any stream is processed, so only construction needs it.
class NoopDurableConfigProvider extends IDurableConfigProvider {
  public get config(): DurableConfig {
    return { model: 'claude-test' } as DurableConfig;
  }
  public update(): void {}
  public updateIdentityBody(): void {}
  public async resolveSystemPromptsFor(): Promise<void> {}
  public async resolveSkillCatalogue(): Promise<void> {}
  public needsSystemPromptResolve(): boolean {
    return false;
  }
  public getEffectiveModel(): string {
    return 'claude-test';
  }
  public getEffectiveThinkingEnabled(): boolean {
    return false;
  }
  public getEffectiveEffort(): ThinkingEffort | undefined {
    return undefined;
  }
}

// TurnRunner is property-injected; build it through a container with test doubles.
function buildTurnRunner(streamer: IMessageStreamer): TurnRunner {
  const services = createServiceCollection();
  services.register(IMessageStreamer).to(IMessageStreamer, () => streamer);
  services.register(IStreamProcessor).to(StreamProcessor);
  // StreamProcessor now @dependsOn(IToolRegistry); an empty registry is a no-op normaliser here.
  services.register(IToolRegistry).to(IToolRegistry, () => new ToolRegistry([], new NoopLogger()));
  services.register(IDurableConfigProvider).to(IDurableConfigProvider, () => new NoopDurableConfigProvider());
  services.register(ILogger).to(NoopLogger);
  services.register(AccountLimitListener).to(NoopAccountLimitListener);
  services.register(ISleepProvider).to(ISleepProvider, () => ({ sleep: async () => {} }));
  services.register(IRandomProvider).to(IRandomProvider, () => ({ next: () => 0.5 }));
  services.register(Clock).to(Clock, () => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC));
  services.register(IWakeLock).to(NoopWakeLock);
  services.register(StreamInterruptListener).to(NoopInterruption);
  services.register(IRequestClockListener).to(NoopRequestClock);
  services.register(TurnRunner).to(TurnRunner);
  return services.buildProvider().resolve(TurnRunner);
}

// Real ConfigLoader, fake reader, real schema — the class's designed test path
// (mirrors packages/claude-core/test/ConfigLoader.spec.ts). Only `thinking` is
// specified; the schema fills every other field's default.
function makeLoader(thinking: ThinkingConfig): ConfigLoader<typeof sdkConfigSchema> {
  const reader = new FakeConfigFileReader(JSON.stringify({ thinking }));
  // ConfigLoader is now a holder built from a parsed ConfigResult (readConfig).
  return new ConfigLoader<typeof sdkConfigSchema>(readConfig({ schema: sdkConfigSchema, paths: ['/sdk-config.json'] }, reader, new MemoryFileSystem({}, '/home', '/project')));
}

// DurableConfigFactory is property-injected; build the whole graph through a
// container with test doubles.
function makeFactory(thinking: ThinkingConfig, override: Override): IDurableConfigProvider {
  const fs = new MemoryFileSystem({}, '/home', '/project');
  const appTools = { tools: [], permissionTools: [], store: new RefStore(new MemoryObjectStore()), refTransform: (_name: string, output: unknown) => output } satisfies AppToolsService;
  const services = createServiceCollection();
  services.register(IRuntimeOptions).to(IRuntimeOptions, () => ({ modelOverride: null, systemFlagText: null, claudeMdFlagText: null, tsAvailable: false }));
  services.register(StatusState).to(StatusState, () => new StatusState('project'));
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(ConfigLoader).to(ConfigLoader, () => makeLoader(thinking));
  services.register(ModelOverrides).to(ModelOverrides);
  services.register(AppToolsService).to(AppToolsService, () => appTools);
  services.register(SystemPromptLoader).to(SystemPromptLoader);
  services.register(ILogger).to(ILogger, () => new NoopLogger());
  services.register(IDurableConfigProvider).to(DurableConfigFactory);
  const provider = services.buildProvider();
  // ModelOverrides has no setter (THINKING_CYCLE = [null, 'on', 'off']); apply the
  // session override via cycleThinking after resolution. config is derived on read,
  // so it reflects the cycled state.
  const overrides = provider.resolve(ModelOverrides);
  if (override === 'on') {
    overrides.cycleThinking();
  } else if (override === 'off') {
    overrides.cycleThinking();
    overrides.cycleThinking();
  }
  return provider.resolve(IDurableConfigProvider);
}

// Drives the wired path and returns the body the runner sent to the streamer.
async function buildBody(factory: IDurableConfigProvider): Promise<BetaMessageStreamParams> {
  const streamer = new FakeMessageStreamer();
  const runner = buildTurnRunner(streamer);
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
