import { Clock, Instant, ZoneId } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { SipsBridge } from '@shellicar/claude-core/image/SipsBridge';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { type ConsumerMessage, Conversation, IConversation, IModelCatalog } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { AuditStats } from '../src/AuditStats.js';
import { IAgentPresence } from '../src/agent/AgentPresence.js';
import type { Presentation } from '../src/app/Presentation.js';
import { PrimaryPresentation } from '../src/app/PrimaryPresentation.js';
import { ViewHost } from '../src/app/ViewHost.js';
import { ApprovalHandler } from '../src/controller/ApprovalHandler.js';
import { CancelHandler } from '../src/controller/CancelHandler.js';
import { CommandIntentExecutor } from '../src/controller/CommandIntentExecutor.js';
import { CommandKeyHandler } from '../src/controller/CommandKeyHandler.js';
import { EditorHandler } from '../src/controller/EditorHandler.js';
import type { InputHandler } from '../src/controller/InputHandler.js';
import { IConvServe } from '../src/conv/ConvServe.js';
import type { AppModeKey } from '../src/model/AppModeState.js';
import { AppModeState } from '../src/model/AppModeState.js';
import { AttachmentSource } from '../src/model/AttachmentSource.js';
import { ICommandModeState } from '../src/model/CommandModeState.js';
import { ConversationListState } from '../src/model/ConversationListState.js';
import { IConversationSession } from '../src/model/ConversationSession.js';
import { ConversationState, IConversationState } from '../src/model/ConversationState.js';
import { IEditorBuffer } from '../src/model/EditorBuffer.js';
import { FrameRegions } from '../src/model/FrameRegions.js';
import { HistoryViewState } from '../src/model/HistoryViewState.js';
import { IntlGraphemeSegmenter } from '../src/model/IntlGraphemeSegmenter.js';
import { ISystemIdentity } from '../src/model/ISystemIdentity.js';
import { ITurnClock } from '../src/model/ITurnClock.js';
import { ModelSettings } from '../src/model/ModelSettings.js';
import { IPrimaryViewState, PrimaryViewState } from '../src/model/PrimaryViewState.js';
import { ScrollState } from '../src/model/ScrollState.js';
import { StatusState } from '../src/model/StatusState.js';
import { SystemIdentity } from '../src/model/SystemIdentity.js';
import { ITerminalState, TerminalState } from '../src/model/TerminalState.js';
import { IToolApprovalState, ToolApprovalState } from '../src/model/ToolApprovalState.js';
import { TurnClock } from '../src/model/TurnClock.js';
import { IWorkingDirectory, WorkingDirectory } from '../src/model/WorkingDirectory.js';
import { ISqliteSessionStore } from '../src/persistence/SqliteSessionStore.js';
import { ConsumerChannel } from '../src/setup/ConsumerChannel.js';
import { ConversationSwitcher, IConversationSwitcher } from '../src/setup/ConversationSwitcher.js';
import { PrimaryView } from '../src/view/PrimaryView.js';
import type { TerminalRenderer } from '../src/view/TerminalRenderer.js';
import type { ViewModel } from '../src/view/View.js';
import { IWorkspace } from '../src/workspace/Workspace.js';
import { buildCommandModeState } from './buildCommandModeState.js';
import { buildEditorBuffer } from './buildEditorBuffer.js';
import { FakeAttachmentSource } from './FakeAttachmentSource.js';
import { FakeWorkspace } from './FakeWorkspace.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';
import { MemoryObjectStore } from './MemoryObjectStore.js';

// Records that a cancel was posted, so streaming-phase escape can be asserted off state.
class RecordingConsumerChannel extends ConsumerChannel {
  readonly #log: string[];
  public constructor(log: string[]) {
    super();
    this.#log = log;
  }
  public override send(_msg: ConsumerMessage): void {
    this.#log.push('cancel');
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeTurnClock(): ITurnClock {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(Clock)
    .using(() => Clock.systemDefaultZone())
    .asSelf();
  services.register(TurnClock).as(ITurnClock);
  return services.buildProvider().resolve(ITurnClock);
}

/** Test double: sips unavailable, so pasted images pass through unconditioned. */
const passthroughSips: SipsBridge = {
  dimensions: () => Promise.reject(new Error('no sips in tests')),
  resizeToPng: () => Promise.reject(new Error('no sips in tests')),
};

/** Test double: a logger that discards everything, so the executor resolves without the app's logger. */
const noopLogger: ILogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function makeModel(): ViewModel {
  const terminalState = new TerminalState();
  terminalState.setSize(80, 24);
  return {
    conversationState: new ConversationState(),
    editorBuffer: buildEditorBuffer(),
    segmenter: new IntlGraphemeSegmenter(),
    toolApprovalState: new ToolApprovalState(),
    commandModeState: buildCommandModeState(),
    statusState: new StatusState('test'),
    turnClock: makeTurnClock(),
    terminalState,
    primaryViewState: new PrimaryViewState(),
    scrollState: new ScrollState(),
    historyViewState: new HistoryViewState(),
    conversationListState: new ConversationListState(),
    clock: Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC),
    appModeState: new AppModeState(),
    session: { id: 'sess' } as unknown as IConversationSession,
    configLoader: { config: { markdown: { enabled: true, streaming: true } } } as unknown as ViewModel['configLoader'],
  };
}

function fakeRenderer(paints: Array<readonly string[]>): TerminalRenderer {
  return {
    paint: (rows: readonly string[]) => {
      paints.push(rows);
    },
  } as unknown as TerminalRenderer;
}

function singlePresentation(activeChain: () => readonly InputHandler[]): ReadonlyMap<AppModeKey, Presentation> {
  return new Map<AppModeKey, Presentation>([['primary', { view: { render: () => ({ rows: [], regions: [] }) }, activeChain }]]);
}

describe('ViewHost — render coalescing', () => {
  it('paints once after a single emission', async () => {
    const model = makeModel();
    const paints: Array<readonly string[]> = [];
    new ViewHost(
      fakeRenderer(paints),
      model,
      singlePresentation(() => []),
      new AppModeState(),
      new FrameRegions(),
    );
    model.conversationState.addBlocks([{ type: 'meta', content: 'x' }]);
    await flush();
    const expected = 1;
    const actual = paints.length;
    expect(actual).toBe(expected);
  });

  it('coalesces multiple emissions in one tick into one paint', async () => {
    const model = makeModel();
    const paints: Array<readonly string[]> = [];
    new ViewHost(
      fakeRenderer(paints),
      model,
      singlePresentation(() => []),
      new AppModeState(),
      new FrameRegions(),
    );
    model.conversationState.addBlocks([{ type: 'meta', content: 'x' }]);
    model.editorBuffer.reset();
    model.statusState.setModel('x');
    await flush();
    const expected = 1;
    const actual = paints.length;
    expect(actual).toBe(expected);
  });
});

describe('ViewHost — key dispatch', () => {
  it('runs the active chain and stops at the first handler that claims the key', () => {
    const model = makeModel();
    const log: string[] = [];
    const h = (name: string, claims: boolean): InputHandler => ({
      handleKey: () => {
        log.push(name);
        return claims;
      },
    });
    const chain: readonly InputHandler[] = [h('a', false), h('b', true), h('c', false)];
    const host = new ViewHost(
      fakeRenderer([]),
      model,
      singlePresentation(() => chain),
      new AppModeState(),
      new FrameRegions(),
    );
    host.dispatchKey({ type: 'char', value: 'x' });
    const expected = ['a', 'b'];
    const actual = log;
    expect(actual).toEqual(expected);
  });

  it('does not paint when no handler claims the key', () => {
    const model = makeModel();
    const paints: Array<readonly string[]> = [];
    const chain: readonly InputHandler[] = [{ handleKey: () => false }];
    const host = new ViewHost(
      fakeRenderer(paints),
      model,
      singlePresentation(() => chain),
      new AppModeState(),
      new FrameRegions(),
    );
    host.dispatchKey({ type: 'escape' });
    const expected = 0;
    const actual = paints.length;
    expect(actual).toBe(expected);
  });

  it('re-resolves the presentation chain on each dispatch', () => {
    const model = makeModel();
    const log: string[] = [];
    const editorChain: readonly InputHandler[] = [
      {
        handleKey: () => {
          log.push('editor');
          return true;
        },
      },
    ];
    const streamingChain: readonly InputHandler[] = [
      {
        handleKey: () => {
          log.push('streaming');
          return true;
        },
      },
    ];
    const presentation = new PrimaryPresentation({ render: () => ({ rows: [], regions: [] }) }, model.primaryViewState, editorChain, streamingChain);
    const host = new ViewHost(fakeRenderer([]), model, new Map<AppModeKey, Presentation>([['primary', presentation]]), new AppModeState(), new FrameRegions());
    host.dispatchKey({ type: 'char', value: 'x' });
    model.primaryViewState.setPhase('streaming');
    host.dispatchKey({ type: 'char', value: 'x' });
    const expected = ['editor', 'streaming'];
    const actual = log;
    expect(actual).toEqual(expected);
  });
});

describe('ViewHost — escape routing through the primary chains', () => {
  function setup() {
    const model = makeModel();
    const cancelLog: string[] = [];
    const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
    services
      .register(Clock)
      .using(() => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC))
      .asSelf();
    services.register(TurnClock).as(ITurnClock);
    services
      .register(ICommandModeState)
      .using(() => model.commandModeState)
      .asSelf();
    services
      .register(IConversationState)
      .using(() => model.conversationState)
      .asSelf();
    services
      .register(IConversationSession)
      .using(() => model.session)
      .asSelf();
    // ConversationSession's own @dependsOn(ISqliteSessionStore) is declared statically, so v5's engine
    // needs a registration even though this factory bypasses field injection entirely.
    services
      .register(ISqliteSessionStore)
      .using(() => ({}) as unknown as ISqliteSessionStore)
      .asSelf();
    services
      .register(IToolApprovalState)
      .using(() => model.toolApprovalState)
      .asSelf();
    services
      .register(IEditorBuffer)
      .using(() => model.editorBuffer)
      .asSelf();
    services
      .register(ITerminalState)
      .using(() => model.terminalState)
      .asSelf();
    services
      .register(IConversation)
      .using(() => new Conversation())
      .asSelf();
    services
      .register(IFileSystem)
      .using(() => new MemoryFileSystem())
      .asSelf();
    services
      .register(IObjectStore)
      .using(() => new MemoryObjectStore())
      .asSelf();
    services.register(SystemIdentity).as(ISystemIdentity);
    services
      .register(ConfigLoader)
      .using(() => ({ config: { historyReplay: { enabled: false, showThinking: false } } }) as unknown as ConfigLoader<never>)
      .asSelf();
    services
      .register(AttachmentSource)
      .using(() => new FakeAttachmentSource())
      .asSelf();
    services
      .register(ModelSettings)
      .using(() => ({ cycleThinking: () => {}, cycleEffort: () => {}, setModel: () => {} }))
      .asSelf();
    services
      .register(IModelCatalog)
      .using(() => ({ list: () => Promise.resolve([]) }))
      .asSelf();
    services
      .register(SipsBridge)
      .using(() => passthroughSips)
      .asSelf();
    services
      .register(ILogger)
      .using(() => noopLogger)
      .asSelf();
    services
      .register(ConsumerChannel)
      .using(() => new RecordingConsumerChannel(cancelLog))
      .asSelf();
    services
      .register(StatusState)
      .using(() => new StatusState('test'))
      .asSelf();
    services.register(AuditStats).asSelf();
    services
      .register(IConvServe)
      .using(() => ({ bind: () => {} }))
      .asSelf();
    services
      .register(IAgentPresence)
      .using(() => ({ instanceId: 'inst-test', world: 'test', boot: () => {}, attach: () => {}, detach: () => {}, stop: () => {} }))
      .asSelf();
    services.register(WorkingDirectory).as(IWorkingDirectory);
    services.register(PrimaryViewState).asSelf().as(IPrimaryViewState);
    services
      .register(FakeWorkspace)
      .using(() => new FakeWorkspace())
      .as(IWorkspace);
    services.register(ConversationSwitcher).as(IConversationSwitcher);
    services.register(CommandIntentExecutor).asSelf();
    services.register(ApprovalHandler).asSelf();
    services.register(CommandKeyHandler).asSelf();
    services.register(EditorHandler).asSelf();
    services.register(CancelHandler).asSelf();
    const provider = services.buildProvider();
    const editorChain: readonly InputHandler[] = [provider.resolve(ApprovalHandler), provider.resolve(CommandKeyHandler), provider.resolve(EditorHandler)];
    const streamingChain: readonly InputHandler[] = [provider.resolve(ApprovalHandler), provider.resolve(CancelHandler)];
    const presentation = new PrimaryPresentation(new PrimaryView(), model.primaryViewState, editorChain, streamingChain);
    const host = new ViewHost(fakeRenderer([]), model, new Map<AppModeKey, Presentation>([['primary', presentation]]), new AppModeState(), new FrameRegions());
    return { host, model, cancelLog };
  }

  it('does not post a cancel for editor-phase escape', () => {
    const { host, cancelLog } = setup();
    host.dispatchKey({ type: 'escape' });
    const expected = 0;
    const actual = cancelLog.length;
    expect(actual).toBe(expected);
  });

  it('posts a cancel for streaming-phase escape', () => {
    const { host, model, cancelLog } = setup();
    model.primaryViewState.setPhase('streaming');
    host.dispatchKey({ type: 'escape' });
    const expected = 1;
    const actual = cancelLog.length;
    expect(actual).toBe(expected);
  });
});

describe('ViewHost — presentation switching', () => {
  function twoPresentations(log: string[]): ReadonlyMap<AppModeKey, Presentation> {
    const primary: Presentation = {
      view: { render: () => ({ rows: [], regions: [] }) },
      activeChain: () => [
        {
          handleKey: () => {
            log.push('primary');
            return true;
          },
        },
      ],
    };
    const history: Presentation = {
      view: { render: () => ({ rows: [], regions: [] }) },
      activeChain: () => [
        {
          handleKey: () => {
            log.push('history');
            return true;
          },
        },
      ],
    };
    return new Map<AppModeKey, Presentation>([
      ['primary', primary],
      ['history', history],
    ]);
  }

  it('dispatches to the active presentation after the app mode flips', () => {
    const model = makeModel();
    const log: string[] = [];
    const appModeState = new AppModeState();
    const host = new ViewHost(fakeRenderer([]), model, twoPresentations(log), appModeState, new FrameRegions());
    host.dispatchKey({ type: 'char', value: 'x' });
    appModeState.setActive('history');
    host.dispatchKey({ type: 'char', value: 'x' });
    const expected = ['primary', 'history'];
    const actual = log;
    expect(actual).toEqual(expected);
  });

  it('repaints when the history view state emits while history is active', async () => {
    const model = makeModel();
    const paints: Array<readonly string[]> = [];
    const appModeState = new AppModeState();
    appModeState.setActive('history');
    new ViewHost(fakeRenderer(paints), model, twoPresentations([]), appModeState, new FrameRegions());
    model.historyViewState.reset();
    await flush();
    const expected = 1;
    const actual = paints.length;
    expect(actual).toBe(expected);
  });
});
