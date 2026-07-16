import { Clock, Instant, ZoneId } from '@js-joda/core';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { SipsBridge } from '@shellicar/claude-core/image/SipsBridge';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { type ConsumerMessage, Conversation, IModelCatalog } from '@shellicar/claude-sdk';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { AuditStats } from '../src/AuditStats.js';
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
import { CommandModeState } from '../src/model/CommandModeState.js';
import { ConversationSession } from '../src/model/ConversationSession.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { EditorState } from '../src/model/EditorState.js';
import { HistoryViewState } from '../src/model/HistoryViewState.js';
import { ISystemIdentity } from '../src/model/ISystemIdentity.js';
import { ITurnClock } from '../src/model/ITurnClock.js';
import { ModelSettings } from '../src/model/ModelSettings.js';
import { PrimaryViewState } from '../src/model/PrimaryViewState.js';
import { ScrollState } from '../src/model/ScrollState.js';
import { StatusState } from '../src/model/StatusState.js';
import { SystemIdentity } from '../src/model/SystemIdentity.js';
import { TerminalState } from '../src/model/TerminalState.js';
import { ToolApprovalState } from '../src/model/ToolApprovalState.js';
import { TurnClock } from '../src/model/TurnClock.js';
import { WorkingDirectory } from '../src/model/WorkingDirectory.js';
import { ConsumerChannel } from '../src/setup/ConsumerChannel.js';
import { PrimaryView } from '../src/view/PrimaryView.js';
import type { TerminalRenderer } from '../src/view/TerminalRenderer.js';
import type { ViewModel } from '../src/view/View.js';
import { FakeAttachmentSource } from './FakeAttachmentSource.js';
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
  const services = createServiceCollection();
  services.register(Clock).to(Clock, () => Clock.systemDefaultZone());
  services.register(ITurnClock).to(TurnClock);
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
    editorState: new EditorState(),
    toolApprovalState: new ToolApprovalState(),
    commandModeState: new CommandModeState(),
    statusState: new StatusState('test'),
    turnClock: makeTurnClock(),
    terminalState,
    primaryViewState: new PrimaryViewState(),
    scrollState: new ScrollState(),
    historyViewState: new HistoryViewState(),
    appModeState: new AppModeState(),
    session: { id: 'sess' } as unknown as ConversationSession,
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
  return new Map<AppModeKey, Presentation>([['primary', { view: { render: () => [] }, activeChain }]]);
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
    );
    model.conversationState.addBlocks([{ type: 'meta', content: 'x' }]);
    model.editorState.reset();
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
    const presentation = new PrimaryPresentation({ render: () => [] }, model.primaryViewState, editorChain, streamingChain);
    const host = new ViewHost(fakeRenderer([]), model, new Map<AppModeKey, Presentation>([['primary', presentation]]), new AppModeState());
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
    const services = createServiceCollection();
    services.register(Clock).to(Clock, () => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC));
    services.register(ITurnClock).to(TurnClock);
    services.register(CommandModeState).to(CommandModeState, () => model.commandModeState);
    services.register(ConversationState).to(ConversationState, () => model.conversationState);
    services.register(ConversationSession).to(ConversationSession, () => model.session);
    services.register(ToolApprovalState).to(ToolApprovalState, () => model.toolApprovalState);
    services.register(EditorState).to(EditorState, () => model.editorState);
    services.register(TerminalState).to(TerminalState, () => model.terminalState);
    services.register(Conversation).to(Conversation, () => new Conversation());
    services.register(IFileSystem).to(IFileSystem, () => new MemoryFileSystem());
    services.register(IObjectStore).to(IObjectStore, () => new MemoryObjectStore());
    services.register(ISystemIdentity).to(SystemIdentity);
    services.register(AttachmentSource).to(AttachmentSource, () => new FakeAttachmentSource());
    services.register(ModelSettings).to(ModelSettings, () => ({ cycleThinking: () => {}, cycleEffort: () => {}, setModel: () => {} }));
    services.register(IModelCatalog).to(IModelCatalog, () => ({ list: () => Promise.resolve([]) }));
    services.register(SipsBridge).to(SipsBridge, () => passthroughSips);
    services.register(ILogger).to(ILogger, () => noopLogger);
    services.register(ConsumerChannel).to(ConsumerChannel, () => new RecordingConsumerChannel(cancelLog));
    services.register(StatusState).to(StatusState, () => new StatusState('test'));
    services.register(AuditStats).to(AuditStats);
    services.register(IConvServe).to(IConvServe, () => ({ bind: () => {} }));
    services.register(WorkingDirectory).to(WorkingDirectory);
    services.register(CommandIntentExecutor).to(CommandIntentExecutor);
    services.register(ApprovalHandler).to(ApprovalHandler);
    services.register(CommandKeyHandler).to(CommandKeyHandler);
    services.register(EditorHandler).to(EditorHandler);
    services.register(CancelHandler).to(CancelHandler);
    const provider = services.buildProvider();
    const editorChain: readonly InputHandler[] = [provider.resolve(ApprovalHandler), provider.resolve(CommandKeyHandler), provider.resolve(EditorHandler)];
    const streamingChain: readonly InputHandler[] = [provider.resolve(ApprovalHandler), provider.resolve(CancelHandler)];
    const presentation = new PrimaryPresentation(new PrimaryView(), model.primaryViewState, editorChain, streamingChain);
    const host = new ViewHost(fakeRenderer([]), model, new Map<AppModeKey, Presentation>([['primary', presentation]]), new AppModeState());
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
      view: { render: () => [] },
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
      view: { render: () => [] },
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
    const host = new ViewHost(fakeRenderer([]), model, twoPresentations(log), appModeState);
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
    new ViewHost(fakeRenderer(paints), model, twoPresentations([]), appModeState);
    model.historyViewState.reset();
    await flush();
    const expected = 1;
    const actual = paints.length;
    expect(actual).toBe(expected);
  });
});
