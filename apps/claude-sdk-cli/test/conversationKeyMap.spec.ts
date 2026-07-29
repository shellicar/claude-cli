import { describe, expect, it } from 'vitest';
import { conversationKeyMap } from '../src/controller/conversationKeyMap.js';

describe('conversationKeyMap — navigation', () => {
  it('moves up the list on the up arrow', () => {
    const expected = 'prev';
    const actual = conversationKeyMap({ type: 'up' });
    expect(actual).toBe(expected);
  });

  it('moves down the list on the down arrow', () => {
    const expected = 'next';
    const actual = conversationKeyMap({ type: 'down' });
    expect(actual).toBe(expected);
  });

  it('moves up the list on a wheel scroll up', () => {
    const expected = 'prev';
    const actual = conversationKeyMap({ type: 'scroll_up' });
    expect(actual).toBe(expected);
  });

  it('moves down the list on a wheel scroll down', () => {
    const expected = 'next';
    const actual = conversationKeyMap({ type: 'scroll_down' });
    expect(actual).toBe(expected);
  });

  it('pages up', () => {
    const expected = 'page-up';
    const actual = conversationKeyMap({ type: 'page_up' });
    expect(actual).toBe(expected);
  });

  it('pages down', () => {
    const expected = 'page-down';
    const actual = conversationKeyMap({ type: 'page_down' });
    expect(actual).toBe(expected);
  });

  it('jumps to the newest on home', () => {
    const expected = 'home';
    const actual = conversationKeyMap({ type: 'home' });
    expect(actual).toBe(expected);
  });

  it('jumps to the oldest on end', () => {
    const expected = 'end';
    const actual = conversationKeyMap({ type: 'end' });
    expect(actual).toBe(expected);
  });
});

describe('conversationKeyMap — peek', () => {
  it('toggles the peek on space', () => {
    const expected = 'toggle-peek';
    const actual = conversationKeyMap({ type: 'char', value: ' ' });
    expect(actual).toBe(expected);
  });

  it('ignores any other character', () => {
    const actual = conversationKeyMap({ type: 'char', value: 'a' });
    expect(actual).toBeNull();
  });
});

describe('conversationKeyMap — unclaimed keys', () => {
  it('leaves enter to the handler, since switching is not navigation', () => {
    const actual = conversationKeyMap({ type: 'enter' });
    expect(actual).toBeNull();
  });

  it('leaves the view keys alone so they reach the view selector', () => {
    const actual = conversationKeyMap({ type: 'f1' });
    expect(actual).toBeNull();
  });
});
