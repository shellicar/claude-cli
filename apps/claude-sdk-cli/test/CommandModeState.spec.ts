import { describe, expect, it } from 'vitest';
import { CommandModeState } from '../src/model/CommandModeState.js';

describe('CommandModeState — initial state', () => {
  it('commandMode starts false', () => {
    const state = new CommandModeState();
    const expected = false;
    const actual = state.commandMode;
    expect(actual).toBe(expected);
  });

  it('previewMode starts false', () => {
    const state = new CommandModeState();
    const expected = false;
    const actual = state.previewMode;
    expect(actual).toBe(expected);
  });

  it('hasAttachments starts false', () => {
    const state = new CommandModeState();
    const expected = false;
    const actual = state.hasAttachments;
    expect(actual).toBe(expected);
  });

  it('attachments starts empty', () => {
    const state = new CommandModeState();
    const expected = 0;
    const actual = state.attachments.length;
    expect(actual).toBe(expected);
  });

  it('selectedIndex starts at -1', () => {
    const state = new CommandModeState();
    const expected = -1;
    const actual = state.selectedIndex;
    expect(actual).toBe(expected);
  });
});

describe('CommandModeState — toggleCommandMode', () => {
  it('flips commandMode from false to true', () => {
    const state = new CommandModeState();
    state.toggleCommandMode();
    const expected = true;
    const actual = state.commandMode;
    expect(actual).toBe(expected);
  });

  it('flips commandMode from true to false', () => {
    const state = new CommandModeState();
    state.toggleCommandMode();
    state.toggleCommandMode();
    const expected = false;
    const actual = state.commandMode;
    expect(actual).toBe(expected);
  });
});

describe('CommandModeState — exitCommandMode', () => {
  it('sets commandMode to false', () => {
    const state = new CommandModeState();
    state.toggleCommandMode();
    state.exitCommandMode();
    const expected = false;
    const actual = state.commandMode;
    expect(actual).toBe(expected);
  });

  it('sets previewMode to false', () => {
    const state = new CommandModeState();
    state.addText('hello');
    state.toggleCommandMode();
    state.togglePreview();
    state.exitCommandMode();
    const expected = false;
    const actual = state.previewMode;
    expect(actual).toBe(expected);
  });
});

describe('CommandModeState — reset', () => {
  it('sets commandMode to false', () => {
    const state = new CommandModeState();
    state.toggleCommandMode();
    state.reset();
    const expected = false;
    const actual = state.commandMode;
    expect(actual).toBe(expected);
  });

  it('sets previewMode to false', () => {
    const state = new CommandModeState();
    state.addText('hello');
    state.togglePreview();
    state.reset();
    const expected = false;
    const actual = state.previewMode;
    expect(actual).toBe(expected);
  });

  it('clears attachments', () => {
    const state = new CommandModeState();
    state.addText('hello');
    state.reset();
    const expected = 0;
    const actual = state.attachments.length;
    expect(actual).toBe(expected);
  });
});

describe('CommandModeState — togglePreview', () => {
  it('is a no-op when nothing is selected', () => {
    const state = new CommandModeState();
    state.togglePreview();
    const expected = false;
    const actual = state.previewMode;
    expect(actual).toBe(expected);
  });

  it('flips previewMode when an attachment is selected', () => {
    const state = new CommandModeState();
    state.addText('hello');
    state.togglePreview();
    const expected = true;
    const actual = state.previewMode;
    expect(actual).toBe(expected);
  });

  it('flips previewMode back when called twice', () => {
    const state = new CommandModeState();
    state.addText('hello');
    state.togglePreview();
    state.togglePreview();
    const expected = false;
    const actual = state.previewMode;
    expect(actual).toBe(expected);
  });
});

describe('CommandModeState — addText', () => {
  it('returns "added" for new text', () => {
    const state = new CommandModeState();
    const expected = 'added';
    const actual = state.addText('hello');
    expect(actual).toBe(expected);
  });

  it('returns "duplicate" for the same text', () => {
    const state = new CommandModeState();
    state.addText('hello');
    const expected = 'duplicate';
    const actual = state.addText('hello');
    expect(actual).toBe(expected);
  });

  it('hasAttachments is true after addText', () => {
    const state = new CommandModeState();
    state.addText('hello');
    const expected = true;
    const actual = state.hasAttachments;
    expect(actual).toBe(expected);
  });
});

describe('CommandModeState — addFile', () => {
  it('returns "added" for a new path', () => {
    const state = new CommandModeState();
    const expected = 'added';
    const actual = state.addFile('/tmp/foo', 'file', 100);
    expect(actual).toBe(expected);
  });

  it('returns "duplicate" for the same path', () => {
    const state = new CommandModeState();
    state.addFile('/tmp/foo', 'file', 100);
    const expected = 'duplicate';
    const actual = state.addFile('/tmp/foo', 'file', 100);
    expect(actual).toBe(expected);
  });
});

describe('CommandModeState — removeSelected', () => {
  it('removes the selected attachment', () => {
    const state = new CommandModeState();
    state.addText('hello');
    state.removeSelected();
    const expected = 0;
    const actual = state.attachments.length;
    expect(actual).toBe(expected);
  });
});

describe('CommandModeState — selectLeft / selectRight', () => {
  it('selectRight moves to the next attachment', () => {
    const state = new CommandModeState();
    state.addText('a');
    state.addText('b');
    // selectedIndex after two adds is 1 (last added)
    state.selectLeft();
    const expected = 0;
    const actual = state.selectedIndex;
    expect(actual).toBe(expected);
  });

  it('selectRight does not exceed last index', () => {
    const state = new CommandModeState();
    state.addText('only');
    state.selectRight();
    const expected = 0;
    const actual = state.selectedIndex;
    expect(actual).toBe(expected);
  });
});

describe('CommandModeState — takeAttachments', () => {
  it('returns null when no attachments', () => {
    const state = new CommandModeState();
    const expected = null;
    const actual = state.takeAttachments();
    expect(actual).toBe(expected);
  });

  it('returns attachments and clears the store', () => {
    const state = new CommandModeState();
    state.addText('hello');
    const taken = state.takeAttachments();
    const expected = 0;
    const actual = state.attachments.length;
    expect(actual).toBe(expected);
    expect(taken).not.toBeNull();
  });
});
