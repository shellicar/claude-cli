import { Clock, Instant, ZoneId } from '@js-joda/core';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { ConversationState, IConversationState } from '../src/model/ConversationState.js';
import { COPY_ICON } from '../src/model/markdown/palette.js';
import { TerminalState } from '../src/model/TerminalState.js';
import { flushSealedToScroll } from '../src/view/flushSealedToScroll.js';
import { renderBlocksToString } from '../src/view/renderConversation.js';
import type { TerminalRenderer } from '../src/view/TerminalRenderer.js';

const NOW = Instant.parse('2026-08-11T00:00:00Z');
const COLS = 80;

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

/** Collects what would have gone to the terminal's scroll buffer. */
class RecordingRenderer {
  public readonly scroll: string[] = [];
  public writeToScroll(text: string): void {
    this.scroll.push(text);
  }
}

function buildConversationState(): ConversationState {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(Clock)
    .using(() => Clock.fixed(NOW, ZoneId.UTC))
    .asSelf();
  services
    .register(ILogger)
    .using(() => new NoopLogger())
    .asSelf();
  services.register(ConversationState).asSelf().as(IConversationState);
  return services.buildProvider().resolve(ConversationState);
}

/** A sealed block with content, which addBlocks cannot produce: it marks what it adds as already flushed. */
function sealedResponse(state: ConversationState, content: string): void {
  state.transitionBlock('response');
  state.appendStreaming(content);
  state.completeActive();
}

function terminal(): TerminalState {
  const terminalState = new TerminalState();
  terminalState.setSize(COLS, 24);
  return terminalState;
}

describe('renderBlocksToString', () => {
  it('heads the first block of a type with its label', () => {
    const expected = true;
    const actual = renderBlocksToString([{ id: 'b1', type: 'response', content: 'hello' }], 0, COLS).includes('response');
    expect(actual).toBe(expected);
  });

  it('draws no copy affordance, since scrollback is the terminal\u2019s and not addressable', () => {
    const expected = false;
    const actual = renderBlocksToString([{ id: 'b1', type: 'response', content: 'hello' }], 0, COLS).includes(COPY_ICON);
    expect(actual).toBe(expected);
  });

  it('heads a run of one type once', () => {
    const out = renderBlocksToString(
      [
        { id: 'b1', type: 'response', content: 'first' },
        { id: 'b2', type: 'response', content: 'second' },
      ],
      0,
      COLS,
    );
    const expected = 1;
    const actual = out.split('response').length - 1;
    expect(actual).toBe(expected);
  });

  it('writes only from the index it was given', () => {
    const expected = false;
    const actual = renderBlocksToString(
      [
        { id: 'b1', type: 'response', content: 'already gone' },
        { id: 'b2', type: 'prompt', content: 'still here' },
      ],
      1,
      COLS,
    ).includes('already gone');
    expect(actual).toBe(expected);
  });

  it('suppresses the header of a block continuing one already written', () => {
    const expected = false;
    const actual = renderBlocksToString(
      [
        { id: 'b1', type: 'response', content: 'already gone' },
        { id: 'b2', type: 'response', content: 'still here' },
      ],
      1,
      COLS,
    ).includes('response');
    expect(actual).toBe(expected);
  });
});

describe('flushSealedToScroll', () => {
  it('writes a newly sealed block to scrollback', () => {
    const state = buildConversationState();
    sealedResponse(state, 'hello');
    const renderer = new RecordingRenderer();
    flushSealedToScroll(state, terminal(), renderer as unknown as TerminalRenderer);
    const expected = true;
    const actual = renderer.scroll[0]?.includes('hello');
    expect(actual).toBe(expected);
  });

  it('advances the flush boundary past what it wrote', () => {
    const state = buildConversationState();
    sealedResponse(state, 'hello');
    flushSealedToScroll(state, terminal(), new RecordingRenderer() as unknown as TerminalRenderer);
    const expected = 1;
    const actual = state.flushedCount;
    expect(actual).toBe(expected);
  });

  it('writes nothing when every sealed block has already gone', () => {
    const state = buildConversationState();
    sealedResponse(state, 'hello');
    const renderer = new RecordingRenderer();
    flushSealedToScroll(state, terminal(), renderer as unknown as TerminalRenderer);
    flushSealedToScroll(state, terminal(), renderer as unknown as TerminalRenderer);
    const expected = 1;
    const actual = renderer.scroll.length;
    expect(actual).toBe(expected);
  });

  it('writes only the block sealed since the last flush', () => {
    const state = buildConversationState();
    sealedResponse(state, 'first');
    const renderer = new RecordingRenderer();
    flushSealedToScroll(state, terminal(), renderer as unknown as TerminalRenderer);
    state.transitionBlock('prompt');
    state.appendStreaming('second');
    state.completeActive();
    flushSealedToScroll(state, terminal(), renderer as unknown as TerminalRenderer);
    const expected = false;
    const actual = renderer.scroll[1]?.includes('first');
    expect(actual).toBe(expected);
  });
});
