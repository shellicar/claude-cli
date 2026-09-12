import { Clock, Instant, ZoneId } from '@js-joda/core';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { ClickHandler } from '../src/controller/ClickHandler.js';
import type { ClickRegion } from '../src/model/ClickRegion.js';
import { ClickTracker, IClickTracker } from '../src/model/ClickTracker.js';
import { IClipboard } from '../src/model/Clipboard.js';
import { FrameRegions, IFrameRegions } from '../src/model/FrameRegions.js';
import { StatusState } from '../src/model/StatusState.js';

const NOW = Instant.parse('2026-08-11T00:00:00Z');

/** Records what reached the clipboard, rather than writing an escape sequence to a screen. */
class RecordingClipboard extends IClipboard {
  public readonly written: string[] = [];
  public write(text: string): void {
    this.written.push(text);
  }
}

const region = (id: string, text: string, row: number): ClickRegion => ({ id, row, startCol: 10, endCol: 12, text });

// ClickHandler injects the regions, the tracker, the clipboard, the status line and a
// clock, so build it through a container holding the ones a test needs to inspect.
function build(regions: readonly ClickRegion[]): { handler: ClickHandler; clipboard: RecordingClipboard; statusState: StatusState } {
  const clipboard = new RecordingClipboard();
  const statusState = new StatusState('test');
  const frameRegions = new FrameRegions();
  frameRegions.set(regions);

  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(Clock)
    .using(() => Clock.fixed(NOW, ZoneId.UTC))
    .asSelf();
  services
    .register(IFrameRegions)
    .using(() => frameRegions)
    .asSelf();
  services
    .register(IClickTracker)
    .using(() => new ClickTracker())
    .asSelf();
  services
    .register(IClipboard)
    .using(() => clipboard)
    .asSelf();
  services
    .register(StatusState)
    .using(() => statusState)
    .asSelf();
  services.register(ClickHandler).asSelf();
  return { handler: services.buildProvider().resolve(ClickHandler), clipboard, statusState };
}

describe('ClickHandler — a completed click', () => {
  it('puts the target text on the clipboard', () => {
    const { handler, clipboard } = build([region('fence-1', 'const a = 1;', 3)]);
    handler.handleKey({ type: 'mouse_down', col: 11, row: 3 });
    handler.handleKey({ type: 'mouse_up', col: 11, row: 3 });
    const expected = ['const a = 1;'];
    const actual = clipboard.written;
    expect(actual).toEqual(expected);
  });

  it('reports how many lines it copied', () => {
    const { handler, statusState } = build([region('fence-1', 'one\ntwo\nthree', 3)]);
    handler.handleKey({ type: 'mouse_down', col: 11, row: 3 });
    handler.handleKey({ type: 'mouse_up', col: 11, row: 3 });
    const expected = 3;
    const actual = statusState.copiedLines;
    expect(actual).toBe(expected);
  });

  it('records when the copy happened', () => {
    const { handler, statusState } = build([region('fence-1', 'const a = 1;', 3)]);
    handler.handleKey({ type: 'mouse_down', col: 11, row: 3 });
    handler.handleKey({ type: 'mouse_up', col: 11, row: 3 });
    const expected = NOW;
    const actual = statusState.copiedAt;
    expect(actual).toEqual(expected);
  });
});

describe('ClickHandler — a click that did not complete', () => {
  it('copies nothing when the release lands on another target', () => {
    const { handler, clipboard } = build([region('fence-1', 'const a = 1;', 3), region('fence-2', 'const b = 2;', 5)]);
    handler.handleKey({ type: 'mouse_down', col: 11, row: 3 });
    handler.handleKey({ type: 'mouse_up', col: 11, row: 5 });
    const expected = 0;
    const actual = clipboard.written.length;
    expect(actual).toBe(expected);
  });

  it('copies nothing when the release lands on empty space', () => {
    const { handler, clipboard } = build([region('fence-1', 'const a = 1;', 3)]);
    handler.handleKey({ type: 'mouse_down', col: 11, row: 3 });
    handler.handleKey({ type: 'mouse_up', col: 40, row: 9 });
    const expected = 0;
    const actual = clipboard.written.length;
    expect(actual).toBe(expected);
  });

  it('copies nothing when the release lands on another block holding identical text', () => {
    const { handler, clipboard } = build([region('block-1', 'continue', 3), region('block-2', 'continue', 5)]);
    handler.handleKey({ type: 'mouse_down', col: 11, row: 3 });
    handler.handleKey({ type: 'mouse_up', col: 11, row: 5 });
    const expected = 0;
    const actual = clipboard.written.length;
    expect(actual).toBe(expected);
  });
});

describe('ClickHandler — what it claims', () => {
  it('claims a press that landed on nothing, so it never reaches the editor', () => {
    const { handler } = build([]);
    const expected = true;
    const actual = handler.handleKey({ type: 'mouse_down', col: 1, row: 1 });
    expect(actual).toBe(expected);
  });

  it('claims a release that landed on nothing', () => {
    const { handler } = build([]);
    const expected = true;
    const actual = handler.handleKey({ type: 'mouse_up', col: 1, row: 1 });
    expect(actual).toBe(expected);
  });

  it('passes a key that is not a mouse event through', () => {
    const { handler } = build([region('fence-1', 'const a = 1;', 3)]);
    const expected = false;
    const actual = handler.handleKey({ type: 'char', value: 'x' });
    expect(actual).toBe(expected);
  });
});
