import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { EditorHandler } from '../src/controller/EditorHandler.js';
import { CommandModeState } from '../src/model/CommandModeState.js';
import { EditorState } from '../src/model/EditorState.js';
import { TerminalState } from '../src/model/TerminalState.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

// EditorHandler injects EditorState/CommandModeState/TerminalState; build it through a container.
function buildEditorHandler(editorState: EditorState, commandModeState: CommandModeState, terminalState: TerminalState): EditorHandler {
  const services = createServiceCollection();
  services.register(EditorState).to(EditorState, () => editorState);
  services.register(CommandModeState).to(CommandModeState, () => commandModeState);
  services.register(TerminalState).to(TerminalState, () => terminalState);
  services.register(EditorHandler).to(EditorHandler);
  return services.buildProvider().resolve(EditorHandler);
}

function make() {
  const editorState = new EditorState();
  const commandModeState = new CommandModeState();
  const terminalState = new TerminalState();
  const handler = buildEditorHandler(editorState, commandModeState, terminalState);
  return { handler, editorState, commandModeState, terminalState };
}

describe('EditorHandler', () => {
  it('claims the up key', () => {
    const { handler } = make();
    const expected = true;
    const actual = handler.handleKey({ type: 'up' });
    expect(actual).toBe(expected);
  });

  it('edits text on a character key', () => {
    const { handler, editorState } = make();
    handler.handleKey({ type: 'char', value: 'a' });
    const expected = 'a';
    const actual = editorState.text;
    expect(actual).toBe(expected);
  });

  it('resolves waitForInput on ctrl+enter with text', async () => {
    const { handler } = make();
    let resolvedText: string | null = null;
    void handler.waitForInput().then((v) => {
      resolvedText = v.text;
    });
    handler.handleKey({ type: 'char', value: 'h' });
    handler.handleKey({ type: 'char', value: 'i' });
    handler.handleKey({ type: 'ctrl+enter' });
    await flush();
    const expected = 'hi';
    const actual = resolvedText;
    expect(actual).toBe(expected);
  });

  it('does not resolve on ctrl+enter when empty with no attachments', async () => {
    const { handler } = make();
    let resolvedText: string | null = null;
    void handler.waitForInput().then((v) => {
      resolvedText = v.text;
    });
    handler.handleKey({ type: 'ctrl+enter' });
    await flush();
    const expected = null;
    const actual = resolvedText;
    expect(actual).toBe(expected);
  });

  it('passes through the escape key', () => {
    const { handler } = make();
    const expected = false;
    const actual = handler.handleKey({ type: 'escape' });
    expect(actual).toBe(expected);
  });
});
