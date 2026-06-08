import { describe, expect, it } from 'vitest';
import type { Presentation } from '../src/app/Presentation.js';
import { PrimaryPresentation } from '../src/app/PrimaryPresentation.js';
import { ViewHost } from '../src/app/ViewHost.js';
import { ApprovalHandler } from '../src/controller/ApprovalHandler.js';
import { CancelHandler } from '../src/controller/CancelHandler.js';
import { CommandIntentExecutor } from '../src/controller/CommandIntentExecutor.js';
import { COMMAND_BINDINGS_BY_CONTEXT, CommandKeyHandler } from '../src/controller/CommandKeyHandler.js';
import { EditorHandler } from '../src/controller/EditorHandler.js';
import type { InputHandler } from '../src/controller/InputHandler.js';
import type { AppModeKey } from '../src/model/AppModeState.js';
import { AppModeState } from '../src/model/AppModeState.js';
import { CommandModeState } from '../src/model/CommandModeState.js';
import type { ConversationSession } from '../src/model/ConversationSession.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { EditorState } from '../src/model/EditorState.js';
import { PrimaryViewState } from '../src/model/PrimaryViewState.js';
import { StatusState } from '../src/model/StatusState.js';
import { TerminalState } from '../src/model/TerminalState.js';
import { ToolApprovalState } from '../src/model/ToolApprovalState.js';
import { PrimaryView } from '../src/view/PrimaryView.js';
import type { TerminalRenderer } from '../src/view/TerminalRenderer.js';
import type { ViewModel } from '../src/view/View.js';
import { FakeAttachmentSource } from './FakeAttachmentSource.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeModel(): ViewModel {
  const terminalState = new TerminalState();
  terminalState.setSize(80, 24);
  return {
    conversationState: new ConversationState(),
    editorState: new EditorState(),
    toolApprovalState: new ToolApprovalState(),
    commandModeState: new CommandModeState(),
    statusState: new StatusState(new MemoryFileSystem({}, '/home/user', '/test')),
    terminalState,
    primaryViewState: new PrimaryViewState(),
    session: { id: 'sess' } as unknown as ConversationSession,
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
    const executor = new CommandIntentExecutor(model.commandModeState, model.conversationState, model.session, new FakeAttachmentSource(), { cycleThinking: () => {}, cycleEffort: () => {} });
    const approvalHandler = new ApprovalHandler(model.toolApprovalState);
    const commandKeyHandler = new CommandKeyHandler(model.commandModeState, COMMAND_BINDINGS_BY_CONTEXT, executor);
    const editorHandler = new EditorHandler(model.editorState, model.commandModeState, model.terminalState);
    const cancelHandler = new CancelHandler(() => cancelLog.push('cancel'));
    const editorChain: readonly InputHandler[] = [approvalHandler, commandKeyHandler, editorHandler];
    const streamingChain: readonly InputHandler[] = [approvalHandler, cancelHandler];
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
