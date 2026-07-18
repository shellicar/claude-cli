import { DatabaseSync } from 'node:sqlite';
import { Clock, Instant, ZoneId } from '@js-joda/core';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { SipsBridge } from '@shellicar/claude-core/image/SipsBridge';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { Conversation, IModelCatalog } from '@shellicar/claude-sdk';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { AuditStats } from '../src/AuditStats.js';
import { CommandIntentExecutor } from '../src/controller/CommandIntentExecutor.js';
import { CommandKeyHandler } from '../src/controller/CommandKeyHandler.js';
import { IConvServe } from '../src/conv/ConvServe.js';
import { logger } from '../src/logger.js';
import { AttachmentSource } from '../src/model/AttachmentSource.js';
import { CommandModeState } from '../src/model/CommandModeState.js';
import { ConversationSession } from '../src/model/ConversationSession.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { ISystemIdentity } from '../src/model/ISystemIdentity.js';
import { ModelSettings } from '../src/model/ModelSettings.js';
import { StatusState } from '../src/model/StatusState.js';
import { SystemIdentity } from '../src/model/SystemIdentity.js';
import { WorkingDirectory } from '../src/model/WorkingDirectory.js';
import { SqliteSessionStore } from '../src/persistence/SqliteSessionStore.js';
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
    setModel: () => {},
  };
  const modelCatalog: IModelCatalog = { list: () => Promise.resolve([]) };
  const services = createServiceCollection();
  services.register(CommandModeState).to(CommandModeState, () => commandModeState);
  services.register(Clock).to(Clock, () => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC));
  services.register(ConversationState).to(ConversationState);
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(Conversation).to(Conversation, () => conversation);
  services.register(SqliteSessionStore).to(SqliteSessionStore, () => new SqliteSessionStore(new DatabaseSync(':memory:'), logger));
  services.register(ConversationSession).to(ConversationSession);
  services.register(IObjectStore).to(IObjectStore, () => new MemoryObjectStore());
  services.register(ISystemIdentity).to(SystemIdentity);
  services.register(AttachmentSource).to(AttachmentSource, () => source);
  services.register(ModelSettings).to(ModelSettings, () => modelSettings);
  services.register(IModelCatalog).to(IModelCatalog, () => modelCatalog);
  services.register(SipsBridge).to(SipsBridge, () => passthroughSips);
  services.register(ILogger).to(ILogger, () => noopLogger);
  services.register(StatusState).to(StatusState, () => new StatusState('test'));
  services.register(AuditStats).to(AuditStats);
  services.register(IConvServe).to(IConvServe, () => ({ bind: () => {} }));
  services.register(WorkingDirectory).to(WorkingDirectory);
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

describe('CommandKeyHandler — cd sub-mode', () => {
  it('enters the cd sub-mode on c', () => {
    const { handler, commandModeState } = makeHandler();
    handler.handleKey({ type: 'ctrl+/' });
    handler.handleKey({ type: 'char', value: 'c' });
    const expected = 'cd';
    const actual = commandModeState.context;
    expect(actual).toBe(expected);
  });

  it('opens the path editor on d inside the cd sub-mode', async () => {
    const { handler, commandModeState } = makeHandler();
    handler.handleKey({ type: 'ctrl+/' });
    handler.handleKey({ type: 'char', value: 'c' });
    handler.handleKey({ type: 'char', value: 'd' });
    await flush();
    const expected = 'cdEdit';
    const actual = commandModeState.context;
    expect(actual).toBe(expected);
  });

  it('pre-fills the path editor with the current directory', async () => {
    const { handler, commandModeState } = makeHandler();
    handler.handleKey({ type: 'ctrl+/' });
    handler.handleKey({ type: 'char', value: 'c' });
    handler.handleKey({ type: 'char', value: 'd' });
    await flush();
    const expected = '/test';
    const actual = commandModeState.cdEditor?.text ?? null;
    expect(actual).toBe(expected);
  });

  it('pops the cd sub-menu back to root on escape', () => {
    const { handler, commandModeState } = makeHandler();
    handler.handleKey({ type: 'ctrl+/' });
    handler.handleKey({ type: 'char', value: 'c' });
    handler.handleKey({ type: 'escape' });
    const expected = 'root';
    const actual = commandModeState.context;
    expect(actual).toBe(expected);
  });
});

describe('CommandKeyHandler — cd path editor', () => {
  async function openEditor() {
    const made = makeHandler();
    made.handler.handleKey({ type: 'ctrl+/' });
    made.handler.handleKey({ type: 'char', value: 'c' });
    made.handler.handleKey({ type: 'char', value: 'd' });
    await flush();
    return made;
  }

  it('forwards a typed character to the editor buffer', async () => {
    const { handler, commandModeState } = await openEditor();
    handler.handleKey({ type: 'char', value: '/' });
    const expected = '/test/';
    const actual = commandModeState.cdEditor?.text ?? null;
    expect(actual).toBe(expected);
  });

  it('backs out to the cd sub-menu on escape', async () => {
    const { handler, commandModeState } = await openEditor();
    handler.handleKey({ type: 'escape' });
    const expected = 'cd';
    const actual = commandModeState.context;
    expect(actual).toBe(expected);
  });

  it('returns to the cd sub-menu on a successful move', async () => {
    const { handler, commandModeState } = await openEditor();
    handler.handleKey({ type: 'enter' });
    await flush();
    const expected = 'cd';
    const actual = commandModeState.context;
    expect(actual).toBe(expected);
  });

  it('keeps the editor open and shows an error on a failed move', async () => {
    const { handler, commandModeState } = await openEditor();
    // Clear the pre-filled path and type a directory that does not exist.
    for (let i = 0; i < '/test'.length; i++) {
      handler.handleKey({ type: 'backspace' });
    }
    for (const ch of '/nowhere') {
      handler.handleKey({ type: 'char', value: ch });
    }
    handler.handleKey({ type: 'enter' });
    await flush();
    const expected = 'cdEdit';
    const actual = commandModeState.context;
    expect(actual).toBe(expected);
  });

  it('surfaces the failure message under the editor', async () => {
    const { handler, commandModeState } = await openEditor();
    for (let i = 0; i < '/test'.length; i++) {
      handler.handleKey({ type: 'backspace' });
    }
    for (const ch of '/nowhere') {
      handler.handleKey({ type: 'char', value: ch });
    }
    handler.handleKey({ type: 'enter' });
    await flush();
    const expected = 'no such directory';
    const actual = commandModeState.cdError;
    expect(actual).toBe(expected);
  });

  it('keeps the editor open when enter is pressed on an emptied path', async () => {
    const { handler, commandModeState } = await openEditor();
    for (let i = 0; i < '/test'.length; i++) {
      handler.handleKey({ type: 'backspace' });
    }
    handler.handleKey({ type: 'enter' });
    await flush();
    const expected = 'cdEdit';
    const actual = commandModeState.context;
    expect(actual).toBe(expected);
  });

  it('shows the no-directory-entered message on an emptied path', async () => {
    const { handler, commandModeState } = await openEditor();
    for (let i = 0; i < '/test'.length; i++) {
      handler.handleKey({ type: 'backspace' });
    }
    handler.handleKey({ type: 'enter' });
    await flush();
    const expected = 'no directory entered';
    const actual = commandModeState.cdError;
    expect(actual).toBe(expected);
  });
});
