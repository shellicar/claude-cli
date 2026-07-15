import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { ScrollHandler } from '../src/controller/ScrollHandler.js';
import { ScrollState } from '../src/model/ScrollState.js';

function setup() {
  const scrollState = new ScrollState();
  scrollState.measure(100, 10, 80); // give the transcript room to scroll
  const services = createServiceCollection();
  services.register(ScrollState).to(ScrollState, () => scrollState);
  services.register(ScrollHandler).to(ScrollHandler);
  const handler = services.buildProvider().resolve(ScrollHandler);
  return { handler, scrollState };
}

describe('ScrollHandler', () => {
  it('scrolls back one notch on scroll_up', () => {
    const { handler, scrollState } = setup();
    handler.handleKey({ type: 'scroll_up' });
    const expected = 3;
    const actual = scrollState.offset;
    expect(actual).toBe(expected);
  });

  it('claims a scroll_up key', () => {
    const { handler } = setup();
    const expected = true;
    const actual = handler.handleKey({ type: 'scroll_up' });
    expect(actual).toBe(expected);
  });

  it('scrolls forward on scroll_down', () => {
    const { handler, scrollState } = setup();
    handler.handleKey({ type: 'scroll_up' });
    handler.handleKey({ type: 'scroll_up' });
    handler.handleKey({ type: 'scroll_down' });
    const expected = 3;
    const actual = scrollState.offset;
    expect(actual).toBe(expected);
  });

  it('pages back by the viewport height on page_up', () => {
    const { handler, scrollState } = setup();
    handler.handleKey({ type: 'page_up' });
    const expected = 10;
    const actual = scrollState.offset;
    expect(actual).toBe(expected);
  });

  it('passes an ordinary character down', () => {
    const { handler } = setup();
    const expected = false;
    const actual = handler.handleKey({ type: 'char', value: 'a' });
    expect(actual).toBe(expected);
  });
});
