import { DatabaseSync } from 'node:sqlite';
import { Clock, Instant, ZoneId } from '@js-joda/core';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { SipsBridge } from '@shellicar/claude-core/image/SipsBridge';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { Conversation, IModelCatalog, type ModelInfo } from '@shellicar/claude-sdk';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { AuditStats } from '../src/AuditStats.js';
import { IAgentPresence } from '../src/agent/AgentPresence.js';
import { CommandIntentExecutor } from '../src/controller/CommandIntentExecutor.js';
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

/** Test double: sips unavailable, so pasted images pass through unconditioned. */
const passthroughSips: SipsBridge = {
  dimensions: () => Promise.reject(new Error('no sips in tests')),
  resizeToPng: () => Promise.reject(new Error('no sips in tests')),
};

/** Test double: a logger that discards everything, so the executor resolves without the app's logger. */
const noopLogger: ILogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function makeExecutor(source: AttachmentSource) {
  const commandModeState = new CommandModeState();
  const fs = new MemoryFileSystem({}, '/home/user', '/test');
  const conversation = new Conversation();
  const cycleCalls = { thinking: 0, effort: 0 };
  const modelCalls: { model: (string | null)[] } = { model: [] };
  const modelSettings: ModelSettings = {
    cycleThinking: () => {
      cycleCalls.thinking += 1;
    },
    cycleEffort: () => {
      cycleCalls.effort += 1;
    },
    setModel: (id) => {
      modelCalls.model.push(id);
    },
  };
  const catalogueModels: ModelInfo[] = [{ id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8' }];
  const modelCatalog: IModelCatalog = { list: () => Promise.resolve(catalogueModels) };
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
  services.register(AuditStats).to(AuditStats); // resolves the already-registered IFileSystem
  services.register(IConvServe).to(IConvServe, () => ({ bind: () => {} }));
  services.register(IAgentPresence).to(IAgentPresence, () => ({ instanceId: 'inst-test', world: 'test', boot: () => {}, attach: () => {}, detach: () => {}, stop: () => {} }));
  services.register(WorkingDirectory).to(WorkingDirectory);
  services.register(CommandIntentExecutor).to(CommandIntentExecutor);
  const provider = services.buildProvider();
  const executor = provider.resolve(CommandIntentExecutor);
  const conversationState = provider.resolve(ConversationState);
  const session = provider.resolve(ConversationSession);
  const statusState = provider.resolve(StatusState);
  return { executor, commandModeState, conversationState, session, cycleCalls, modelCalls, statusState };
}

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fileType(state: CommandModeState): string | null {
  const att = state.attachments[0];
  return att?.kind === 'file' ? att.fileType : null;
}

describe('CommandIntentExecutor — pasteText', () => {
  it('adds a text attachment from the clipboard', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource({ text: 'hello' }));
    await executor.execute('pasteText');
    const expected = 'text';
    const actual = commandModeState.attachments[0]?.kind ?? null;
    expect(actual).toBe(expected);
  });

  it('adds nothing when the clipboard is empty', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource({ text: null }));
    await executor.execute('pasteText');
    const expected = 0;
    const actual = commandModeState.attachments.length;
    expect(actual).toBe(expected);
  });
});

describe('CommandIntentExecutor — pasteFile', () => {
  it('adds a file attachment for an existing file', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource({ path: '/tmp/x.ts', stat: { isDirectory: false, size: 42 } }));
    await executor.execute('pasteFile');
    const expected = 'file';
    const actual = fileType(commandModeState);
    expect(actual).toBe(expected);
  });

  it('adds a dir attachment for a directory', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource({ path: '/tmp/dir', stat: { isDirectory: true, size: 0 } }));
    await executor.execute('pasteFile');
    const expected = 'dir';
    const actual = fileType(commandModeState);
    expect(actual).toBe(expected);
  });

  it('adds a missing attachment for a deliberate path that does not exist', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource({ path: '/tmp/missing', stat: null }));
    await executor.execute('pasteFile');
    const expected = 'missing';
    const actual = fileType(commandModeState);
    expect(actual).toBe(expected);
  });

  it('adds nothing for a non-path string that does not exist', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource({ path: 'notapath', stat: null }));
    await executor.execute('pasteFile');
    const expected = 0;
    const actual = commandModeState.attachments.length;
    expect(actual).toBe(expected);
  });
});

describe('CommandIntentExecutor — pasteImage', () => {
  it('adds an image attachment for recognised image bytes', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource({ image: { kind: 'image', data: PNG_HEADER } }));
    await executor.execute('pasteImage');
    const expected = 'image';
    const actual = commandModeState.attachments[0]?.kind ?? null;
    expect(actual).toBe(expected);
  });

  it('adds nothing when the clipboard has no image', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource({ image: { kind: 'empty' } }));
    await executor.execute('pasteImage');
    const expected = 0;
    const actual = commandModeState.attachments.length;
    expect(actual).toBe(expected);
  });
});

describe('CommandIntentExecutor — attachment editing', () => {
  it('removes the selected attachment', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource({ text: 'hello' }));
    await executor.execute('pasteText');
    await executor.execute('removeAttachment');
    const expected = 0;
    const actual = commandModeState.attachments.length;
    expect(actual).toBe(expected);
  });

  it('toggles the preview for the selected attachment', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource({ text: 'hello' }));
    await executor.execute('pasteText');
    await executor.execute('togglePreview');
    const expected = true;
    const actual = commandModeState.previewMode;
    expect(actual).toBe(expected);
  });
});

describe('CommandIntentExecutor — newSession', () => {
  it('clears the conversation', async () => {
    const { executor, conversationState } = makeExecutor(new FakeAttachmentSource());
    conversationState.addBlocks([{ type: 'response', content: 'old' }]);
    await executor.execute('newSession');
    const expected = 0;
    const actual = conversationState.sealedBlocks.length;
    expect(actual).toBe(expected);
  });
});

describe('CommandIntentExecutor — newSession re-derives the stats', () => {
  it('resets the status figures to empty for the fresh id (no audit data)', async () => {
    const { executor, statusState } = makeExecutor(new FakeAttachmentSource());
    statusState.resetTo({ inputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0.01, lastContextUsed: 500, contextWindow: 200_000 });
    await executor.execute('newSession');
    const expected = 0;
    const actual = statusState.totalInputTokens;
    expect(actual).toBe(expected);
  });
});

describe('CommandIntentExecutor — model sub-mode', () => {
  it('enterModelSubMode sets the command context to model', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource());
    await executor.execute('enterModelSubMode');
    const expected = 'model';
    const actual = commandModeState.context;
    expect(actual).toBe(expected);
  });

  it('cycleThinking invokes the injected model settings', async () => {
    const { executor, cycleCalls } = makeExecutor(new FakeAttachmentSource());
    await executor.execute('cycleThinking');
    const expected = 1;
    const actual = cycleCalls.thinking;
    expect(actual).toBe(expected);
  });

  it('cycleEffort invokes the injected model settings', async () => {
    const { executor, cycleCalls } = makeExecutor(new FakeAttachmentSource());
    await executor.execute('cycleEffort');
    const expected = 1;
    const actual = cycleCalls.effort;
    expect(actual).toBe(expected);
  });
});

describe('CommandIntentExecutor — cd sub-mode', () => {
  it('enterCdSubMode sets the command context to cd', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource());
    await executor.execute('enterCdSubMode');
    const expected = 'cd';
    const actual = commandModeState.context;
    expect(actual).toBe(expected);
  });

  it('openCdEditor pre-fills the editor with the current directory', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource());
    await executor.execute('openCdEditor');
    const expected = '/test';
    const actual = commandModeState.cdEditor?.text ?? null;
    expect(actual).toBe(expected);
  });

  it('submitCd returns to the cd sub-menu on a successful move', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource());
    await executor.execute('openCdEditor');
    await executor.execute('submitCd');
    const expected = 'cd';
    const actual = commandModeState.context;
    expect(actual).toBe(expected);
  });

  it('submitCd keeps the editor open on a failed move', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource());
    await executor.execute('openCdEditor');
    commandModeState.cdEditor?.reset();
    for (const ch of '/nowhere') {
      commandModeState.cdEditor?.handleKey({ type: 'char', value: ch });
    }
    await executor.execute('submitCd');
    const expected = 'cdEdit';
    const actual = commandModeState.context;
    expect(actual).toBe(expected);
  });
});

describe('CommandIntentExecutor — model editor', () => {
  it('openModelEditor pre-fills the editor with the effective model', async () => {
    const { executor, commandModeState, statusState } = makeExecutor(new FakeAttachmentSource());
    statusState.setModel('claude-hello-world');
    await executor.execute('openModelEditor');
    const expected = 'claude-hello-world';
    const actual = commandModeState.modelEditor?.text ?? null;
    expect(actual).toBe(expected);
  });

  it('openModelEditor loads the catalogue ids for the blue match', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource());
    await executor.execute('openModelEditor');
    const expected = true;
    const actual = commandModeState.knownModels.has('claude-opus-4-8');
    expect(actual).toBe(expected);
  });

  it('submitModel sets the override to the typed model', async () => {
    const { executor, commandModeState, modelCalls, statusState } = makeExecutor(new FakeAttachmentSource());
    statusState.setModel('claude-opus-4-8');
    await executor.execute('openModelEditor');
    commandModeState.modelEditor?.reset();
    for (const ch of 'claude-sonnet-5') {
      commandModeState.modelEditor?.handleKey({ type: 'char', value: ch });
    }
    await executor.execute('submitModel');
    const expected = ['claude-sonnet-5'];
    const actual = modelCalls.model;
    expect(actual).toEqual(expected);
  });

  it('submitModel clears the override when the editor is empty', async () => {
    const { executor, commandModeState, modelCalls, statusState } = makeExecutor(new FakeAttachmentSource());
    statusState.setModel('claude-opus-4-8');
    await executor.execute('openModelEditor');
    commandModeState.modelEditor?.reset();
    await executor.execute('submitModel');
    const expected = [null];
    const actual = modelCalls.model;
    expect(actual).toEqual(expected);
  });

  it('submitModel returns to the model sub-mode', async () => {
    const { executor, commandModeState } = makeExecutor(new FakeAttachmentSource());
    await executor.execute('openModelEditor');
    await executor.execute('submitModel');
    const expected = 'model';
    const actual = commandModeState.context;
    expect(actual).toBe(expected);
  });
});
