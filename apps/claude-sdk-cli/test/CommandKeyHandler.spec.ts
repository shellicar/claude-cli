import { Clock } from '@js-joda/core';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { IClockProvider } from '@shellicar/claude-core/providers/IClockProvider';
import { Conversation } from '@shellicar/claude-sdk';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { CommandIntentExecutor } from '../src/controller/CommandIntentExecutor.js';
import { CommandKeyHandler } from '../src/controller/CommandKeyHandler.js';
import { AttachmentSource } from '../src/model/AttachmentSource.js';
import { CommandModeState } from '../src/model/CommandModeState.js';
import { ConversationSession } from '../src/model/ConversationSession.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { ModelSettings } from '../src/model/ModelSettings.js';
import { FakeAttachmentSource } from './FakeAttachmentSource.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeHandler(sourceText: string | null = null) {
  const commandModeState = new CommandModeState();
  const fs = new MemoryFileSystem({}, '/home/user', '/test');
  const conversation = new Conversation();
  const source = new FakeAttachmentSource({ text: sourceText });
  const cycleCalls = { thinking: 0, effort: 0 };
  const modelSettings: ModelSettings = {
    cycleThinking: () => {
      cycleCalls.thinking += 1;
    },
    cycleEffort: () => {
      cycleCalls.effort += 1;
    },
  };
  const services = createServiceCollection();
  services.register(CommandModeState).to(CommandModeState, () => commandModeState);
  services.register(IClockProvider).to(IClockProvider, () => ({ clock: Clock.systemUTC() }));
  services.register(ConversationState).to(ConversationState);
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(Conversation).to(Conversation, () => conversation);
  services.register(ConversationSession).to(ConversationSession);
  services.register(AttachmentSource).to(AttachmentSource, () => source);
  services.register(ModelSettings).to(ModelSettings, () => modelSettings);
  services.register(CommandIntentExecutor).to(CommandIntentExecutor);
  services.register(CommandKeyHandler).to(CommandKeyHandler);
  const handler = services.buildProvider().resolve(CommandKeyHandler);
  return { handler, commandModeState, cycleCalls };
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

describe('CommandKeyHandler — model sub-mode', () => {
  it('enters the model sub-mode on m', () => {
    const { handler, commandModeState } = makeHandler();
    handler.handleKey({ type: 'ctrl+/' });
    handler.handleKey({ type: 'char', value: 'm' });
    const expected = 'model';
    const actual = commandModeState.context;
    expect(actual).toBe(expected);
  });

  it('cycles thinking on t inside the model sub-mode', async () => {
    const { handler, cycleCalls } = makeHandler();
    handler.handleKey({ type: 'ctrl+/' });
    handler.handleKey({ type: 'char', value: 'm' });
    handler.handleKey({ type: 'char', value: 't' });
    await flush();
    const expected = 1;
    const actual = cycleCalls.thinking;
    expect(actual).toBe(expected);
  });

  it('cycles effort on e inside the model sub-mode', async () => {
    const { handler, cycleCalls } = makeHandler();
    handler.handleKey({ type: 'ctrl+/' });
    handler.handleKey({ type: 'char', value: 'm' });
    handler.handleKey({ type: 'char', value: 'e' });
    await flush();
    const expected = 1;
    const actual = cycleCalls.effort;
    expect(actual).toBe(expected);
  });

  it('pops back to root on escape', () => {
    const { handler, commandModeState } = makeHandler();
    handler.handleKey({ type: 'ctrl+/' });
    handler.handleKey({ type: 'char', value: 'm' });
    handler.handleKey({ type: 'escape' });
    const expected = 'root';
    const actual = commandModeState.context;
    expect(actual).toBe(expected);
  });

  it('keeps command mode open when escape pops the sub-mode', () => {
    const { handler, commandModeState } = makeHandler();
    handler.handleKey({ type: 'ctrl+/' });
    handler.handleKey({ type: 'char', value: 'm' });
    handler.handleKey({ type: 'escape' });
    const expected = true;
    const actual = commandModeState.commandMode;
    expect(actual).toBe(expected);
  });
});
