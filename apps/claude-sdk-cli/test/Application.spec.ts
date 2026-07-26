import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import type { ConfigWatchHandle as ConfigWatchHandleType } from '@shellicar/claude-core/Config/types';
import { ConfigWatchHandle } from '@shellicar/claude-core/Config/types';
import { AnthropicAuth, IConversation } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { ViewHost } from '../src/app/ViewHost.js';
import { EditorHandler } from '../src/controller/EditorHandler.js';
import { IWireSayInbox } from '../src/conv/WireSayInbox.js';
import { ICommandModeState } from '../src/model/CommandModeState.js';
import { IConversationState } from '../src/model/ConversationState.js';
import { IEditorState } from '../src/model/EditorState.js';
import { ITurnClock } from '../src/model/ITurnClock.js';
import { ITerminalState } from '../src/model/TerminalState.js';
import { ReadLine } from '../src/ReadLine.js';
import { IAgentBusActivator } from '../src/setup/AgentBusActivator.js';
import { Application, type RunAppArgs } from '../src/setup/Application.js';
import { IConfigChangeCoordinator } from '../src/setup/ConfigChangeCoordinator.js';
import { RulesConfigWatchHandle } from '../src/setup/ConfigRulesConfigProvider.js';
import { IConsumerMessageRouter } from '../src/setup/ConsumerMessageRouter.js';
import { IConversationBootSequence } from '../src/setup/ConversationBootSequence.js';
import { ISessionActivator } from '../src/setup/SessionActivator.js';
import { IShutdownSequence } from '../src/setup/ShutdownSequence.js';
import { ITurnCoordinator } from '../src/setup/TurnCoordinator.js';
import { IWorkingDirectoryMoveHandler } from '../src/setup/WorkingDirectoryMoveHandler.js';
import { Flasher } from '../src/view/Flasher.js';
import { TerminalRenderer } from '../src/view/TerminalRenderer.js';

// The drain path between the agent surface and the shutdown wiring, as a fake: like the real
// AgentServicer, a drain with no listener yet is dropped silently — that drop is the bug under test.
class DrainWire {
  #listener: (() => void) | null = null;
  public handled = false;
  public subscribe(listener: () => void): void {
    this.#listener = listener;
  }
  public emit(): void {
    this.#listener?.();
  }
}

// Stands in for ShutdownSequence.wire(): subscribing the drain handler is the part of the real
// wire() this behaviour depends on; process.exit and the rest are irrelevant here.
class FakeShutdownSequence extends IShutdownSequence {
  public constructor(private readonly drain: DrainWire) {
    super();
  }
  public wire(): void {
    this.drain.subscribe(() => {
      this.drain.handled = true;
    });
  }
  public setIdentityWatch(_handle: ConfigWatchHandleType): void {}
}

// Activation delivers a drain the moment the agent surface is live — the earliest instant the wire
// can address this process (agent-spec: the requests subject binds inside activate()).
class FakeAgentBusActivator extends IAgentBusActivator {
  public constructor(private readonly drain: DrainWire) {
    super();
  }
  public async activate(): Promise<void> {
    this.drain.emit();
  }
}

const pendingForever = <T>(): Promise<T> => new Promise<T>(() => {});

// Tracks whether the terminal is currently in the renderer's entered (raw/alt-screen) state — the
// observable output the teardown behaviour must restore on a startup failure.
class FakeTerminalRenderer {
  public active = false;
  public enter(): void {
    this.active = true;
  }
  public exit(): void {
    this.active = false;
  }
}

// Tracks stdin raw mode the way the real ReadLine owns it: on at `enable()`, off at disposal — the
// other half of the terminal state a startup failure must restore.
class FakeReadLine {
  public raw = false;
  public enable(): void {
    this.raw = true;
  }
  public [Symbol.dispose](): void {
    this.raw = false;
  }
}

type ApplicationOverrides = {
  renderer?: FakeTerminalRenderer;
  readLine?: FakeReadLine;
  bootSequence?: Pick<IConversationBootSequence, 'run'>;
};

function buildApplication(drain: DrainWire, overrides: ApplicationOverrides = {}): Application {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(ConfigWatchHandle)
    .using(() => ({}) as unknown as ConfigWatchHandle)
    .asSelf();
  services
    .register(ConfigLoader)
    .using(() => ({}) as unknown as ConfigLoader<never>)
    .asSelf();
  services
    .register(RulesConfigWatchHandle)
    .using(() => ({}) as unknown as ConfigWatchHandle)
    .asSelf();
  services
    .register(AnthropicAuth)
    .using(() => ({ getCredentials: async () => ({}) }) as unknown as AnthropicAuth)
    .asSelf();
  services
    .register(ISessionActivator)
    .using(() => ({ activate: async () => {} }) as unknown as ISessionActivator)
    .asSelf();
  services
    .register(IWireSayInbox)
    .using(() => ({ next: () => pendingForever() }) as unknown as IWireSayInbox)
    .asSelf();
  services
    .register(FakeAgentBusActivator)
    .using(() => new FakeAgentBusActivator(drain))
    .as(IAgentBusActivator);
  services
    .register(IConversationState)
    .using(() => ({ markPromptStart: () => {} }) as unknown as IConversationState)
    .asSelf();
  services
    .register(ITurnCoordinator)
    .using(() => ({ runTurn: async () => {} }) as unknown as ITurnCoordinator)
    .asSelf();
  services
    .register(IConfigChangeCoordinator)
    .using(() => ({ wire: () => {} }) as unknown as IConfigChangeCoordinator)
    .asSelf();
  services
    .register(IWorkingDirectoryMoveHandler)
    .using(() => ({ wire: () => {} }) as unknown as IWorkingDirectoryMoveHandler)
    .asSelf();
  services
    .register(FakeShutdownSequence)
    .using(() => new FakeShutdownSequence(drain))
    .as(IShutdownSequence);
  services
    .register(IConsumerMessageRouter)
    .using(() => ({ wire: () => {} }) as unknown as IConsumerMessageRouter)
    .asSelf();
  services
    .register(TerminalRenderer)
    .using(() => (overrides.renderer ?? { enter: () => {} }) as unknown as TerminalRenderer)
    .asSelf();
  services
    .register(ViewHost)
    .using(() => ({ renderNow: () => {}, scheduleRender: () => {} }) as unknown as ViewHost)
    .asSelf();
  services
    .register(Flasher)
    .using(() => ({}) as unknown as Flasher)
    .asSelf();
  services
    .register(ReadLine)
    .using(() => (overrides.readLine ?? { enable: () => {} }) as unknown as ReadLine)
    .asSelf();
  services
    .register(IConversationBootSequence)
    .using(() => (overrides.bootSequence ?? { run: async () => {} }) as unknown as IConversationBootSequence)
    .asSelf();
  // EditorHandler's own @dependsOn tokens are planned even though a factory supplies the stub,
  // so its five leaves need registrations too (all abstract, so the cascade stops here).
  services
    .register(IEditorState)
    .using(() => ({}) as unknown as IEditorState)
    .asSelf();
  services
    .register(ICommandModeState)
    .using(() => ({}) as unknown as ICommandModeState)
    .asSelf();
  services
    .register(ITerminalState)
    .using(() => ({}) as unknown as ITerminalState)
    .asSelf();
  services
    .register(IConversation)
    .using(() => ({}) as unknown as IConversation)
    .asSelf();
  services
    .register(ITurnClock)
    .using(() => ({}) as unknown as ITurnClock)
    .asSelf();
  services
    .register(EditorHandler)
    .using(() => ({ waitForInput: () => pendingForever() }) as unknown as EditorHandler)
    .asSelf();
  services.register(Application).asSelf();
  return services.buildProvider().resolve(Application);
}

const args: RunAppArgs = {
  initialFilePaths: [],
  initialPrompt: null,
  decodedPrompt: null,
  noResume: false,
  sessionName: null,
  resumeId: null,
  identityPath: null,
  configOverride: undefined,
};

describe('Application', () => {
  it('handles a drain that arrives the moment the agent surface is live', async () => {
    const drain = new DrainWire();
    const app = buildApplication(drain);
    // run() never returns (main loop); let startup flush, then assert.
    void app.run(args);
    await new Promise((done) => setImmediate(done));
    const expected = true;
    const actual = drain.handled;
    expect(actual).toBe(expected);
  });

  it('restores the terminal when startup fails after the renderer has entered', async () => {
    const renderer = new FakeTerminalRenderer();
    const bootSequence = {
      run: async () => {
        throw new Error('boot failed');
      },
    };
    const app = buildApplication(new DrainWire(), { renderer, bootSequence });
    await app.run(args).catch(() => {});
    const expected = false;
    const actual = renderer.active;
    expect(actual).toBe(expected);
  });

  it('restores stdin raw mode when startup fails after readline is enabled', async () => {
    const readLine = new FakeReadLine();
    const bootSequence = {
      run: async () => {
        throw new Error('boot failed');
      },
    };
    const app = buildApplication(new DrainWire(), { readLine, bootSequence });
    await app.run(args).catch(() => {});
    const expected = false;
    const actual = readLine.raw;
    expect(actual).toBe(expected);
  });
});
