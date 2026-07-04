import { Clock } from '@js-joda/core';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { AppModeState } from '../src/model/AppModeState.js';
import { CommandModeState } from '../src/model/CommandModeState.js';
import type { ConversationSession } from '../src/model/ConversationSession.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { EditorState } from '../src/model/EditorState.js';
import { HistoryViewState } from '../src/model/HistoryViewState.js';
import { ITurnClock } from '../src/model/ITurnClock.js';
import { PrimaryViewState } from '../src/model/PrimaryViewState.js';
import { StatusState } from '../src/model/StatusState.js';
import { TerminalState } from '../src/model/TerminalState.js';
import { ToolApprovalState } from '../src/model/ToolApprovalState.js';
import { TurnClock } from '../src/model/TurnClock.js';
import { HistoryView } from '../src/view/HistoryView.js';
import { renderViewBar } from '../src/view/renderViewBar.js';
import type { ViewModel } from '../src/view/View.js';

const CONTENT_INDENT = '   ';

function makeTurnClock(): ITurnClock {
  const services = createServiceCollection();
  services.register(Clock).to(Clock, () => Clock.systemDefaultZone());
  services.register(ITurnClock).to(TurnClock);
  return services.buildProvider().resolve(ITurnClock);
}

// Block 0 (response) is focused by default; its 8-line content exercises the
// collapsed cap and the open growth. Block 1 is a tools box; block 2 is an
// unfocused response that stays flush.
function makeModel(firstContent = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8'): ViewModel {
  const terminalState = new TerminalState();
  terminalState.setSize(80, 24);
  const conversationState = new ConversationState();
  conversationState.addBlocks([
    { type: 'response', content: firstContent },
    {
      type: 'tools',
      content: 'tool lines',
      tools: [
        { name: 'ReadFile', kind: 'client', input: { path: 'a.ts' }, output: 'file contents', phase: 'done' },
        { name: 'Exec', kind: 'client', input: { cmd: 'ls' }, output: 'listing', phase: 'done' },
      ],
    },
    { type: 'response', content: 'reply' },
  ]);
  return {
    conversationState,
    editorState: new EditorState(),
    toolApprovalState: new ToolApprovalState(),
    commandModeState: new CommandModeState(),
    statusState: new StatusState('test'),
    turnClock: makeTurnClock(),
    terminalState,
    primaryViewState: new PrimaryViewState(),
    historyViewState: new HistoryViewState(),
    appModeState: new AppModeState(),
    session: { id: 'sess', turnCount: 0 } as unknown as ConversationSession,
    configLoader: { config: { markdown: { enabled: true, streaming: true } } } as unknown as ViewModel['configLoader'],
  };
}

describe('HistoryView — box model', () => {
  it('gutters the focused block content', () => {
    const expected = `> ${CONTENT_INDENT}l1`;
    const actual = new HistoryView().render(makeModel());
    expect(actual).toContain(expected);
  });

  it('caps a long collapsed block with an ellipsis line', () => {
    const expected = `> ${CONTENT_INDENT}...`;
    const actual = new HistoryView().render(makeModel());
    expect(actual).toContain(expected);
  });

  it('renders an unfocused block flush, without a gutter', () => {
    const expected = `${CONTENT_INDENT}reply`;
    const actual = new HistoryView().render(makeModel());
    expect(actual).toContain(expected);
  });

  it('reveals content beyond the collapsed cap once the block is opened', () => {
    const model = makeModel();
    model.historyViewState.apply('open', model.conversationState.sealedBlocks);
    const expected = `${CONTENT_INDENT}l8`;
    const actual = new HistoryView().render(model);
    expect(actual).toContain(expected);
  });

  it('lists the focused tool with a gutter when a tools block is descended', () => {
    const model = makeModel();
    const bs = model.conversationState.sealedBlocks;
    model.historyViewState.apply('next', bs); // focus the tools block
    model.historyViewState.apply('open', bs); // descend to tool 0
    const expected = '> ReadFile';
    const actual = new HistoryView().render(model);
    expect(actual).toContain(expected);
  });

  it('shows a tool input when the tool is opened', () => {
    const model = makeModel();
    const bs = model.conversationState.sealedBlocks;
    model.historyViewState.apply('next', bs); // focus the tools block
    model.historyViewState.apply('open', bs); // descend to tool 0
    model.historyViewState.apply('open', bs); // open tool 0
    const expected = `${CONTENT_INDENT}  {"path":"a.ts"}`;
    const actual = new HistoryView().render(model);
    expect(actual).toContain(expected);
  });

  it('shows a tool output when the tool is opened', () => {
    const model = makeModel();
    const bs = model.conversationState.sealedBlocks;
    model.historyViewState.apply('next', bs); // focus the tools block
    model.historyViewState.apply('open', bs); // descend to tool 0
    model.historyViewState.apply('open', bs); // open tool 0
    const expected = `${CONTENT_INDENT}  file contents`;
    const actual = new HistoryView().render(model);
    expect(actual).toContain(expected);
  });

  it('renders the view bar as the footer row', () => {
    const expected = renderViewBar('primary');
    const actual = new HistoryView().render(makeModel()).at(-1);
    expect(actual).toBe(expected);
  });

  it('fills the screen height', () => {
    const expected = 24;
    const actual = new HistoryView().render(makeModel()).length;
    expect(actual).toBe(expected);
  });

  it('marks more-below with an ellipsis when open content overflows the screen', () => {
    const tall = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join('\n');
    const model = makeModel(tall);
    model.historyViewState.apply('open', model.conversationState.sealedBlocks);
    const expected = `${CONTENT_INDENT}...`;
    const actual = new HistoryView().render(model);
    expect(actual).toContain(expected);
  });

  it('never renders a ~~~ scroll band', () => {
    const tall = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join('\n');
    const model = makeModel(tall);
    model.historyViewState.apply('open', model.conversationState.sealedBlocks);
    const actual = new HistoryView().render(model).find((row) => row.includes('~'));
    expect(actual).toBeUndefined();
  });
});

// Render-level frames asserted against the Navigation illustrations. These cover
// the rendered output, not just the state machine — state-only green is not done.
describe('HistoryView — frames against the illustrations', () => {
  it('shows no ellipsis when a collapsed block fits', () => {
    // Every block's content fits the cap, and the short stack is not clipped,
    // so no `...` marker (collapsed cap or centre clip) should appear anywhere.
    const model = makeModel('only one line');
    const actual = new HistoryView().render(model).find((row) => row.includes('...'));
    expect(actual).toBeUndefined();
  });

  it('centres the focused box on the screen', () => {
    // The focused box's midline sits on the body's middle row; that row is part
    // of the focused box, so it carries the gutter.
    const middleRow = Math.floor((24 - 1) / 2);
    const expected = '> ';
    const actual = new HistoryView().render(makeModel())[middleRow]?.slice(0, 2);
    expect(actual).toBe(expected);
  });

  it('marks the opened block with an (open) header', () => {
    const model = makeModel();
    model.historyViewState.apply('open', model.conversationState.sealedBlocks);
    const actual = new HistoryView().render(model).find((row) => row.includes('(open)'));
    expect(actual).toBeDefined();
  });

  it('leaves the frame unchanged when moving up at the first block', () => {
    const model = makeModel();
    const view = new HistoryView();
    const expected = view.render(model);
    model.historyViewState.apply('prev', model.conversationState.sealedBlocks);
    const actual = view.render(model);
    expect(actual).toEqual(expected);
  });

  it('leaves the frame unchanged when moving down at the last block', () => {
    const model = makeModel();
    const bs = model.conversationState.sealedBlocks;
    model.historyViewState.apply('end', bs);
    const view = new HistoryView();
    const expected = view.render(model);
    model.historyViewState.apply('next', bs);
    const actual = view.render(model);
    expect(actual).toEqual(expected);
  });

  it('changes the frame when moving up from the last block', () => {
    const model = makeModel();
    const bs = model.conversationState.sealedBlocks;
    model.historyViewState.apply('end', bs);
    const view = new HistoryView();
    const atEnd = view.render(model);
    model.historyViewState.apply('prev', bs);
    const actual = view.render(model);
    expect(actual).not.toEqual(atEnd);
  });

  it('slides the content to reveal the last line when scrolled to the end', () => {
    const tall = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join('\n');
    const model = makeModel(tall);
    const bs = model.conversationState.sealedBlocks;
    model.historyViewState.apply('open', bs);
    model.historyViewState.apply('end', bs, 100);
    const expected = `${CONTENT_INDENT}line30`;
    const actual = new HistoryView().render(model);
    expect(actual).toContain(expected);
  });

  it('keeps the open header fixed while the content scrolls', () => {
    const tall = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join('\n');
    const model = makeModel(tall);
    const bs = model.conversationState.sealedBlocks;
    model.historyViewState.apply('open', bs);
    const view = new HistoryView();
    const expected = view.render(model).find((row) => row.includes('(open)'));
    model.historyViewState.apply('end', bs, 100);
    const actual = view.render(model).find((row) => row.includes('(open)'));
    expect(actual).toBe(expected);
  });
});
