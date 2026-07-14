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

// ---------------------------------------------------------------------------
// context / sub-mode
// ---------------------------------------------------------------------------

describe('CommandModeState — context', () => {
  it('context starts as root', () => {
    const state = new CommandModeState();
    const expected = 'root';
    const actual = state.context;
    expect(actual).toBe(expected);
  });

  it('enterModelSubMode sets context to model', () => {
    const state = new CommandModeState();
    state.enterModelSubMode();
    const expected = 'model';
    const actual = state.context;
    expect(actual).toBe(expected);
  });

  it('exitModelSubMode resets context to root', () => {
    const state = new CommandModeState();
    state.enterModelSubMode();
    state.exitModelSubMode();
    const expected = 'root';
    const actual = state.context;
    expect(actual).toBe(expected);
  });

  it('exitCommandMode resets context to root', () => {
    const state = new CommandModeState();
    state.toggleCommandMode();
    state.enterModelSubMode();
    state.exitCommandMode();
    const expected = 'root';
    const actual = state.context;
    expect(actual).toBe(expected);
  });

  it('toggleCommandMode resets context to root when turning off', () => {
    const state = new CommandModeState();
    state.toggleCommandMode();
    state.enterModelSubMode();
    state.toggleCommandMode();
    const expected = 'root';
    const actual = state.context;
    expect(actual).toBe(expected);
  });

  it('reset resets context to root', () => {
    const state = new CommandModeState();
    state.toggleCommandMode();
    state.enterModelSubMode();
    state.reset();
    const expected = 'root';
    const actual = state.context;
    expect(actual).toBe(expected);
  });
});

describe('CommandModeState — cd sub-mode', () => {
  it('enterCdSubMode sets the context to cd', () => {
    const state = new CommandModeState();
    state.enterCdSubMode();
    const expected = 'cd';
    const actual = state.context;
    expect(actual).toBe(expected);
  });

  it('exitCdSubMode returns the context to root', () => {
    const state = new CommandModeState();
    state.enterCdSubMode();
    state.exitCdSubMode();
    const expected = 'root';
    const actual = state.context;
    expect(actual).toBe(expected);
  });

  it('openCdEditor sets the context to cdEdit', () => {
    const state = new CommandModeState();
    state.openCdEditor('/repos/project');
    const expected = 'cdEdit';
    const actual = state.context;
    expect(actual).toBe(expected);
  });

  it('openCdEditor pre-fills the editor with the given directory', () => {
    const state = new CommandModeState();
    state.openCdEditor('/repos/project');
    const expected = '/repos/project';
    const actual = state.cdEditor?.text ?? null;
    expect(actual).toBe(expected);
  });

  it('openCdEditor places the cursor at the end of the pre-filled path', () => {
    const state = new CommandModeState();
    state.openCdEditor('/repos/project');
    const expected = '/repos/project'.length;
    const actual = state.cdEditor?.cursorCol ?? null;
    expect(actual).toBe(expected);
  });

  it('closeCdEditor returns to the cd sub-menu', () => {
    const state = new CommandModeState();
    state.openCdEditor('/repos/project');
    state.closeCdEditor();
    const expected = 'cd';
    const actual = state.context;
    expect(actual).toBe(expected);
  });

  it('closeCdEditor clears the editor buffer', () => {
    const state = new CommandModeState();
    state.openCdEditor('/repos/project');
    state.closeCdEditor();
    const expected = null;
    const actual = state.cdEditor;
    expect(actual).toBe(expected);
  });

  it('setCdError records the failure message', () => {
    const state = new CommandModeState();
    state.openCdEditor('/repos/project');
    state.setCdError('no such directory');
    const expected = 'no such directory';
    const actual = state.cdError;
    expect(actual).toBe(expected);
  });

  it('handleCdEditorKey clears a shown error on the next edit', () => {
    const state = new CommandModeState();
    state.openCdEditor('/x');
    state.setCdError('no such directory');
    state.handleCdEditorKey({ type: 'char', value: '/' });
    const expected = null;
    const actual = state.cdError;
    expect(actual).toBe(expected);
  });

  it('exitCommandMode clears the open cd editor', () => {
    const state = new CommandModeState();
    state.openCdEditor('/repos/project');
    state.exitCommandMode();
    const expected = null;
    const actual = state.cdEditor;
    expect(actual).toBe(expected);
  });
});
