import { Clock, Instant, ZoneId } from '@js-joda/core';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import { AppModeState } from '../src/model/AppModeState.js';
import { hitTest } from '../src/model/ClickRegion.js';
import { ConversationListState } from '../src/model/ConversationListState.js';
import type { ConversationSession } from '../src/model/ConversationSession.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { HistoryViewState } from '../src/model/HistoryViewState.js';
import { IntlGraphemeSegmenter } from '../src/model/IntlGraphemeSegmenter.js';
import { ITurnClock } from '../src/model/ITurnClock.js';
import { COPY_ICON } from '../src/model/markdown/palette.js';
import { PrimaryViewState } from '../src/model/PrimaryViewState.js';
import { ScrollState } from '../src/model/ScrollState.js';
import { StatusState } from '../src/model/StatusState.js';
import { TerminalState } from '../src/model/TerminalState.js';
import { ToolApprovalState } from '../src/model/ToolApprovalState.js';
import { TurnClock } from '../src/model/TurnClock.js';
import { PrimaryView } from '../src/view/PrimaryView.js';
import type { Frame, ViewModel } from '../src/view/View.js';
import { buildCommandModeState } from './buildCommandModeState.js';
import { buildEditorBuffer } from './buildEditorBuffer.js';

const NOW = Instant.parse('2026-08-11T00:00:00Z');
const CODE = 'const a = 1;\nconst b = 2;';
const RESPONSE = ['before', '', '```ts', CODE, '```', '', 'after'].join('\n');

function strip(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI for test assertions
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * The glyph occupying a column of a row. Walked by display width rather than indexed by
 * code point, because a wide glyph such as a block emoji occupies two columns and would
 * put every later index one out.
 */
function glyphAtColumn(row: string, column: number): string | undefined {
  let at = 0;
  for (const glyph of strip(row)) {
    if (at === column) {
      return glyph;
    }
    at += stringWidth(glyph);
  }
  return undefined;
}

/**
 * The cell the code block's own affordance addresses, as the operator sees it. Found by
 * what it copies, not by its place in the array: a block header carries an affordance
 * too, so position says nothing about which one this is.
 */
function cellUnderCodeRegion(frame: Frame): string | undefined {
  const region = frame.regions.find((candidate) => candidate.text === CODE);
  if (!region) {
    return undefined;
  }
  return glyphAtColumn(frame.rows[region.row] ?? '', region.startCol);
}

function makeTurnClock(): ITurnClock {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(Clock)
    .using(() => Clock.fixed(NOW, ZoneId.UTC))
    .asSelf();
  services.register(TurnClock).as(ITurnClock);
  return services.buildProvider().resolve(ITurnClock);
}

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
    clock: Clock.fixed(NOW, ZoneId.UTC),
    appModeState: new AppModeState(),
    session: { id: 'sess-123', turnCount: 0 } as unknown as ConversationSession,
    configLoader: { config: { markdown: { enabled: true, streaming: true } } } as unknown as ViewModel['configLoader'],
  };
}

function sealedCodeBlock(): ViewModel {
  const model = makeModel();
  model.conversationState.addBlocks([{ type: 'response', content: RESPONSE }]);
  return model;
}

function streamingCodeBlock(): ViewModel {
  const model = makeModel();
  model.conversationState.transitionBlock('response');
  model.conversationState.appendStreaming(`${RESPONSE}\n`);
  return model;
}

describe('PrimaryView — regions against the frame it painted', () => {
  it('addresses the cell the copy icon was drawn in', () => {
    const expected = COPY_ICON;
    const actual = cellUnderCodeRegion(new PrimaryView().render(sealedCodeBlock()));
    expect(actual).toBe(expected);
  });

  it('resolves a click on that cell back to the block source', () => {
    const frame = new PrimaryView().render(sealedCodeBlock());
    const region = frame.regions.find((candidate) => candidate.text === CODE);
    const expected = CODE;
    const actual = hitTest(frame.regions, region?.startCol ?? -1, region?.row ?? -1)?.text;
    expect(actual).toBe(expected);
  });

  it('still addresses the icon after the transcript is scrolled back', () => {
    const model = sealedCodeBlock();
    model.conversationState.addBlocks(Array.from({ length: 40 }, (_, i) => ({ type: 'meta' as const, content: `line ${i}` })));
    const view = new PrimaryView();
    view.render(model);
    for (let i = 0; i < 30; i++) {
      model.scrollState.lineUp();
    }
    const expected = COPY_ICON;
    const actual = cellUnderCodeRegion(view.render(model));
    expect(actual).toBe(expected);
  });
});

describe('PrimaryView — regions while a response is still streaming', () => {
  it('draws the copy icon on a code block in the streaming response', () => {
    const expected = true;
    const actual = new PrimaryView().render(streamingCodeBlock()).rows.some((row) => row.includes(COPY_ICON));
    expect(actual).toBe(expected);
  });

  it('makes the icon it drew clickable', () => {
    const expected = true;
    const actual = new PrimaryView().render(streamingCodeBlock()).regions.length > 0;
    expect(actual).toBe(expected);
  });
});
