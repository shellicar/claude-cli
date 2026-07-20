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
import {
  AccountLimitListener,
  type AnyToolDefinition,
  Conversation,
  IDisabledToolsProvider,
  IDurableConfigProvider,
  IMessageStreamer,
  IRequestClockListener,
  IStreamProcessor,
  IToolRegistry,
  IWakeLock,
  StreamInterruptListener,
  StreamProcessor,
  ToolRegistry,
  TurnRunner,
  type WakeLockHandle,
} from '@shellicar/claude-sdk';
import { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { sdkConfigSchema } from '../src/cli-config/schema.js';
import { StatusState } from '../src/model/StatusState.js';
import { SystemPromptLoader } from '../src/SystemPromptLoader.js';
import { AppToolsService } from '../src/setup/AppToolsService.js';
import { ConfigDisabledToolsProvider } from '../src/setup/ConfigDisabledToolsProvider.js';
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

function makeTool(name: string): AnyToolDefinition {
  return {
    name,
    description: `${name} description`,
    input_schema: { toJSONSchema: () => ({}) } as unknown as AnyToolDefinition['input_schema'],
    output_schema: { toJSONSchema: () => ({}) } as unknown as AnyToolDefinition['output_schema'],
    input_examples: [],
    handler: async () => ({ textContent: '' }),
  };
}

function makeLoader(disabledTools: string[]): ConfigLoader<typeof sdkConfigSchema> {
  const reader = new FakeConfigFileReader(JSON.stringify({ disabledTools }));
  return new ConfigLoader<typeof sdkConfigSchema>(readConfig({ schema: sdkConfigSchema, paths: ['/sdk-config.json'] }, reader, new MemoryFileSystem({}, '/home', '/project')));
}

// One container wired the same way the CLI's own setup/container.ts wires it: DurableConfigFactory,
// TurnRunner, StreamProcessor and ToolRegistry all share the same ConfigLoader (carrying
// disabledTools) and the same IDisabledToolsProvider. Only test doubles for network/timing/IO.
function buildHarness(tools: AnyToolDefinition[], disabledTools: string[]) {
  const fs = new MemoryFileSystem({}, '/home', '/project');
  const appTools = { tools, permissionTools: [], store: new RefStore(new MemoryObjectStore()), refTransform: (_name: string, output: unknown) => output } satisfies AppToolsService;
  const streamer = new FakeMessageStreamer();

  const services = createServiceCollection();
  services.register(IRuntimeOptions).to(IRuntimeOptions, () => ({ modelOverride: null, systemFlagText: null, claudeMdFlagText: null, tsAvailable: false }));
  services.register(StatusState).to(StatusState, () => new StatusState('project'));
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(ConfigLoader).to(ConfigLoader, () => makeLoader(disabledTools));
  services.register(ModelOverrides).to(ModelOverrides);
  services.register(AppToolsService).to(AppToolsService, () => appTools);
  services.register(SystemPromptLoader).to(SystemPromptLoader);
  services.register(ILogger).to(NoopLogger);
  services.register(IDurableConfigProvider).to(DurableConfigFactory);
  services.register(IDisabledToolsProvider).to(ConfigDisabledToolsProvider);
  // Mirrors container.ts: ToolRegistry built from the tool list plus the live disabledToolsProvider.
  services.register(IToolRegistry).to(IToolRegistry, (x) => new ToolRegistry(tools, x.resolve(ILogger), (p) => p, x.resolve(IDisabledToolsProvider)));
  services.register(IMessageStreamer).to(IMessageStreamer, () => streamer);
  services.register(IStreamProcessor).to(StreamProcessor);
  services.register(AccountLimitListener).to(NoopAccountLimitListener);
  services.register(ISleepProvider).to(ISleepProvider, () => ({ sleep: async () => {} }));
  services.register(IRandomProvider).to(IRandomProvider, () => ({ next: () => 0.5 }));
  services.register(Clock).to(Clock, () => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC));
  services.register(IWakeLock).to(NoopWakeLock);
  services.register(StreamInterruptListener).to(NoopInterruption);
  services.register(IRequestClockListener).to(NoopRequestClock);
  services.register(TurnRunner).to(TurnRunner);

  const provider = services.buildProvider();
  return { runner: provider.resolve(TurnRunner), durableConfig: provider.resolve(IDurableConfigProvider), streamer };
}

// Drives the wired path and returns the body the runner actually sent to the streamer — the
// true test of what the model is told exists, independent of ToolRegistry.wireTools in isolation.
async function buildBody(tools: AnyToolDefinition[], disabledTools: string[]): Promise<BetaMessageStreamParams> {
  const { runner, durableConfig, streamer } = buildHarness(tools, disabledTools);
  const conv = new Conversation();
  conv.push({ role: 'user', content: 'hi' });
  await runner.run(conv, durableConfig.config, { abortSignal: new AbortController().signal }).catch(() => {});
  const body = streamer.bodies[0];
  if (body == null) {
    throw new Error('no request body captured');
  }
  return body;
}

describe('disabledTools config → request body (wired end-to-end)', () => {
  it('a tool named in disabledTools is not sent to the API', async () => {
    const tools = [makeTool('dangerous_tool'), makeTool('safe_tool')];

    const body = await buildBody(tools, ['dangerous_tool']);
    const actual = (body.tools ?? []).map((t) => ('name' in t ? t.name : undefined));

    expect(actual).not.toContain('dangerous_tool');
  });

  it('a tool not named in disabledTools is still sent to the API', async () => {
    const tools = [makeTool('dangerous_tool'), makeTool('safe_tool')];

    const body = await buildBody(tools, ['dangerous_tool']);
    const actual = (body.tools ?? []).map((t) => ('name' in t ? t.name : undefined));

    expect(actual).toContain('safe_tool');
  });
});
