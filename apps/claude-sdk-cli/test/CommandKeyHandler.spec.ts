import { Conversation } from '@shellicar/claude-sdk';
import { describe, expect, it } from 'vitest';
import { CommandIntentExecutor } from '../src/controller/CommandIntentExecutor.js';
import { CommandKeyHandler, PRIMARY_COMMAND_BINDINGS } from '../src/controller/CommandKeyHandler.js';
import { CommandModeState } from '../src/model/CommandModeState.js';
import { ConversationSession } from '../src/model/ConversationSession.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { FakeAttachmentSource } from './FakeAttachmentSource.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeHandler(sourceText: string | null = null) {
  const commandModeState = new CommandModeState();
  const conversationState = new ConversationState();
  const session = new ConversationSession(new MemoryFileSystem({}, '/home/user', '/test'), new Conversation());
  const source = new FakeAttachmentSource({ text: sourceText });
  const executor = new CommandIntentExecutor(commandModeState, conversationState, session, source);
  const handler = new CommandKeyHandler(commandModeState, PRIMARY_COMMAND_BINDINGS, executor);
  return { handler, commandModeState };
}

describe('CommandKeyHandler — ctrl+/', () => {
  it('opens command mode', () => {
    const { handler, commandModeState } = makeHandler();
    handler.handleKey({ type: 'ctrl+/' });
    const expected = true;
    const actual = commandModeState.commandMode;
    expect(actual).toBe(expected);
  });

  it('claims ctrl+/', () => {
    const { handler } = makeHandler();
    const expected = true;
    const actual = handler.handleKey({ type: 'ctrl+/' });
    expect(actual).toBe(expected);
  });

  it('closes command mode when toggled again', () => {
    const { handler, commandModeState } = makeHandler();
    handler.handleKey({ type: 'ctrl+/' });
    handler.handleKey({ type: 'ctrl+/' });
    const expected = false;
    const actual = commandModeState.commandMode;
    expect(actual).toBe(expected);
  });
});

describe('CommandKeyHandler — command mode closed', () => {
  it('passes through a non-ctrl+/ key', () => {
    const { handler } = makeHandler();
    const expected = false;
    const actual = handler.handleKey({ type: 'char', value: 't' });
    expect(actual).toBe(expected);
  });
});

describe('CommandKeyHandler — command mode open', () => {
  it('closes command mode on escape', () => {
    const { handler, commandModeState } = makeHandler();
    handler.handleKey({ type: 'ctrl+/' });
    handler.handleKey({ type: 'escape' });
    const expected = false;
    const actual = commandModeState.commandMode;
    expect(actual).toBe(expected);
  });

  it('runs the bound intent for a recognised key', async () => {
    const { handler, commandModeState } = makeHandler('clipboard text');
    handler.handleKey({ type: 'ctrl+/' });
    handler.handleKey({ type: 'char', value: 't' });
    await flush();
    const expected = 'text';
    const actual = commandModeState.attachments[0]?.kind ?? null;
    expect(actual).toBe(expected);
  });

  it('claims an unrecognised char without changing state', async () => {
    const { handler, commandModeState } = makeHandler('clipboard text');
    handler.handleKey({ type: 'ctrl+/' });
    const claimed = handler.handleKey({ type: 'char', value: 'z' });
    await flush();
    const expected = true;
    const actual = claimed && commandModeState.attachments.length === 0;
    expect(actual).toBe(expected);
  });
});
