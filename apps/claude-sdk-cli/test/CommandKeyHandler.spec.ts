import { DatabaseSync } from 'node:sqlite';
import { Clock, Instant, ZoneId } from '@js-joda/core';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { SipsBridge } from '@shellicar/claude-core/image/SipsBridge';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { Conversation } from '@shellicar/claude-sdk';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { AuditStats } from '../src/AuditStats.js';
import { CommandIntentExecutor } from '../src/controller/CommandIntentExecutor.js';
import { CommandKeyHandler } from '../src/controller/CommandKeyHandler.js';
import { AttachmentSource } from '../src/model/AttachmentSource.js';
import { CommandModeState } from '../src/model/CommandModeState.js';
import { ConversationSession } from '../src/model/ConversationSession.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { ISystemIdentity } from '../src/model/ISystemIdentity.js';
import { ModelSettings } from '../src/model/ModelSettings.js';
import { StatusState } from '../src/model/StatusState.js';
import { SystemIdentity } from '../src/model/SystemIdentity.js';
import { SqliteSessionStore } from '../src/persistence/SqliteSessionStore.js';
import { ITap } from '../src/tap/ITap.js';
import { FakeAttachmentSource } from './FakeAttachmentSource.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';
import { MemoryObjectStore } from './MemoryObjectStore.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Test double: sips unavailable, so pasted images pass through unconditioned. */
const passthroughSips: SipsBridge = {
  dimensions: () => Promise.reject(new Error('no sips in tests')),
  resizeToPng: () => Promise.reject(new Error('no sips in tests')),
};

/** Test double: a logger that discards everything, so the executor resolves without the app's logger. */
const noopLogger: ILogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

// CommandIntentExecutor announces conversation switches to the tap; a no-op tap satisfies the dependency.
class NoopTap extends ITap {
  public async start(): Promise<void> {}
  public publish(): void {}
  public switchConversation(): void {}
  public async stop(): Promise<void> {}
}

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
  services.register(Clock).to(Clock, () => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC));
  services.register(ConversationState).to(ConversationState);
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(Conversation).to(Conversation, () => conversation);
  services.register(SqliteSessionStore).to(SqliteSessionStore, () => new SqliteSessionStore(new DatabaseSync(':memory:')));
  services.register(ConversationSession).to(ConversationSession);
  services.register(IObjectStore).to(IObjectStore, () => new MemoryObjectStore());
  services.register(ISystemIdentity).to(SystemIdentity);
  services.register(AttachmentSource).to(AttachmentSource, () => source);
  services.register(ModelSettings).to(ModelSettings, () => modelSettings);
  services.register(SipsBridge).to(SipsBridge, () => passthroughSips);
  services.register(ILogger).to(ILogger, () => noopLogger);
  services.register(ITap).to(NoopTap);
  services.register(StatusState).to(StatusState, () => new StatusState('test'));
  services.register(AuditStats).to(AuditStats);
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
