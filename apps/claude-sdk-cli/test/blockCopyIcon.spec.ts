import { Clock, Instant, ZoneId } from '@js-joda/core';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import { ConversationState, IConversationState } from '../src/model/ConversationState.js';
import { COPY_ICON } from '../src/model/markdown/palette.js';
import { renderConversationFrame } from '../src/view/renderConversation.js';

const NOW = Instant.parse('2026-08-11T00:00:00Z');

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

function buildConversationState(): IConversationState {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services.register(NoopLogger).as(ILogger);
  services
    .register(Clock)
    .using(() => Clock.fixed(NOW, ZoneId.UTC))
    .asSelf();
  services.register(ConversationState).as(IConversationState);
  return services.buildProvider().resolve(IConversationState);
}

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

/** The visible cell a region addresses, as the operator sees it. */
function cellUnder(frame: { lines: string[]; regions: Array<{ row: number; startCol: number }> }, index: number): string | undefined {
  const region = frame.regions[index];
  if (!region) {
    return undefined;
  }
  return glyphAtColumn(frame.lines[region.row] ?? '', region.startCol);
}

const sealed = (...blocks: Array<{ type: 'response' | 'thinking'; content: string }>): IConversationState => {
  const state = buildConversationState();
  state.addBlocks(blocks);
  return state;
};

describe('a sealed block carries a copy affordance on its header', () => {
  it('addresses the cell the icon was drawn in', () => {
    const expected = COPY_ICON;
    const actual = cellUnder(renderConversationFrame(sealed({ type: 'response', content: 'hello' }), 80), 0);
    expect(actual).toBe(expected);
  });

  it('copies the block content', () => {
    const expected = 'hello';
    const actual = renderConversationFrame(sealed({ type: 'response', content: 'hello' }), 80).regions[0]?.text;
    expect(actual).toBe(expected);
  });

  it('gives a block of each type its own affordance', () => {
    const expected = 2;
    const actual = renderConversationFrame(sealed({ type: 'thinking', content: 'pondering' }, { type: 'response', content: 'hello' }), 80).regions.length;
    expect(actual).toBe(expected);
  });

  it('copies the whole run when same-type blocks share one header', () => {
    const expected = 'onetwo';
    const actual = renderConversationFrame(sealed({ type: 'response', content: 'one' }, { type: 'response', content: 'two' }), 80).regions[0]?.text;
    expect(actual).toBe(expected);
  });

  it('draws one affordance for a run sharing one header', () => {
    const expected = 1;
    const actual = renderConversationFrame(sealed({ type: 'response', content: 'one' }, { type: 'response', content: 'two' }), 80).regions.length;
    expect(actual).toBe(expected);
  });
});

describe('a block still being written carries none', () => {
  it('offers nothing to copy while the block is open', () => {
    const state = buildConversationState();
    state.transitionBlock('response');
    state.appendToActive('half a thou');
    const expected = 0;
    const actual = renderConversationFrame(state, 80).regions.length;
    expect(actual).toBe(expected);
  });

  it('draws no icon while the block is open', () => {
    const state = buildConversationState();
    state.transitionBlock('response');
    state.appendToActive('half a thou');
    const expected = false;
    const actual = renderConversationFrame(state, 80).lines.some((row) => row.includes(COPY_ICON));
    expect(actual).toBe(expected);
  });
});

describe('the header keeps its shape', () => {
  it('still shows the block label', () => {
    const expected = true;
    const actual = strip(renderConversationFrame(sealed({ type: 'response', content: 'hello' }), 80).lines[0] ?? '').includes('response');
    expect(actual).toBe(expected);
  });

  it('puts the icon at the end of the divider', () => {
    const frame = renderConversationFrame(sealed({ type: 'response', content: 'hello' }), 80);
    const expected = stringWidth(strip(frame.lines[0] ?? '')) - 1;
    const actual = frame.regions[0]?.startCol;
    expect(actual).toBe(expected);
  });
});
