import { DatabaseSync } from 'node:sqlite';
import { Clock, Instant, ZoneId } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { SipsBridge } from '@shellicar/claude-core/image/SipsBridge';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { Conversation, IConversation, IModelCatalog, type ModelInfo } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { AuditStats } from '../src/AuditStats.js';
import { IAgentPresence } from '../src/agent/AgentPresence.js';
import { CommandIntentExecutor } from '../src/controller/CommandIntentExecutor.js';
import { IConvServe } from '../src/conv/ConvServe.js';
import { logger } from '../src/logger.js';
import { AttachmentSource } from '../src/model/AttachmentSource.js';
import { CommandModeState, ICommandModeState } from '../src/model/CommandModeState.js';
import { ConversationSession, IConversationSession } from '../src/model/ConversationSession.js';
import { ConversationState, IConversationState } from '../src/model/ConversationState.js';
import { editorText } from '../src/model/EditorContent.js';
import { IGraphemeSegmenter } from '../src/model/IGraphemeSegmenter.js';
import { IntlGraphemeSegmenter } from '../src/model/IntlGraphemeSegmenter.js';
import { ISystemIdentity } from '../src/model/ISystemIdentity.js';
import { ModelSettings } from '../src/model/ModelSettings.js';
import { IPrimaryViewState, PrimaryViewState } from '../src/model/PrimaryViewState.js';
import { StatusState } from '../src/model/StatusState.js';
import { SystemIdentity } from '../src/model/SystemIdentity.js';
import { IWorkingDirectory, WorkingDirectory } from '../src/model/WorkingDirectory.js';
import { ISqliteSessionStore, SqliteSessionStore } from '../src/persistence/SqliteSessionStore.js';
import { ConversationSwitcher, IConversationSwitcher } from '../src/setup/ConversationSwitcher.js';
import { IWorkspace } from '../src/workspace/Workspace.js';
import { buildCommandModeState } from './buildCommandModeState.js';
import { FakeAttachmentSource } from './FakeAttachmentSource.js';
import { FakeWorkspace } from './FakeWorkspace.js';
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
  const commandModeState = buildCommandModeState();
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
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services.register(IntlGraphemeSegmenter).asSelf().as(IGraphemeSegmenter);
  services
    .register(CommandModeState)
    .using(() => commandModeState)
    .asSelf()
    .as(ICommandModeState);
  services
    .register(Clock)
    .using(() => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC))
    .asSelf();
  services.register(ConversationState).asSelf().as(IConversationState);
  services
    .register(IFileSystem)
    .using(() => fs)
    .asSelf();
  services
    .register(Conversation)
    .using(() => conversation)
    .asSelf()
    .as(IConversation);
  services
    .register(SqliteSessionStore)
    .using(() => new SqliteSessionStore(new DatabaseSync(':memory:'), logger))
    .asSelf()
    .as(ISqliteSessionStore);
  services.register(ConversationSession).asSelf().as(IConversationSession);
  services
    .register(IObjectStore)
    .using(() => new MemoryObjectStore())
    .asSelf();
  services.register(SystemIdentity).as(ISystemIdentity);
  services
    .register(ConfigLoader)
    .using(() => ({ config: { historyReplay: { enabled: false, showThinking: false } } }) as unknown as ConfigLoader<never>)
    .asSelf();
  services
    .register(AttachmentSource)
    .using(() => source)
    .asSelf();
  services
    .register(ModelSettings)
    .using(() => modelSettings)
    .asSelf();
  services
    .register(IModelCatalog)
    .using(() => modelCatalog)
    .asSelf();
  services
    .register(SipsBridge)
    .using(() => passthroughSips)
    .asSelf();
  services
    .register(ILogger)
    .using(() => noopLogger)
    .asSelf();
  services
    .register(StatusState)
    .using(() => new StatusState('test'))
    .asSelf();
  services.register(AuditStats).asSelf(); // resolves the already-registered IFileSystem
  services
    .register(IConvServe)
    .using(() => ({ bind: () => {} }))
    .asSelf();
  services
    .register(IAgentPresence)
    .using(() => ({ instanceId: 'inst-test', world: 'test', boot: () => {}, attach: () => {}, detach: () => {}, stop: () => {} }))
    .asSelf();
  services.register(WorkingDirectory).asSelf().as(IWorkingDirectory);
  services.register(PrimaryViewState).asSelf().as(IPrimaryViewState);
  services
    .register(FakeWorkspace)
    .using(() => new FakeWorkspace())
    .as(IWorkspace);
  services.register(ConversationSwitcher).as(IConversationSwitcher);
  services.register(CommandIntentExecutor).asSelf();
  const provider = services.buildProvider();
  const executor = provider.resolve(CommandIntentExecutor);
  const conversationState = provider.resolve(ConversationState);
  const session = provider.resolve(ConversationSession);
  const statusState = provider.resolve(StatusState);
  const primaryViewState = provider.resolve(PrimaryViewState);
  return { executor, commandModeState, conversationState, session, cycleCalls, modelCalls, statusState, primaryViewState };
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

describe('CommandIntentExecutor — newSession during a turn', () => {
  it('does not start a new conversation while a turn is running', async () => {
    const { executor, session, primaryViewState } = makeExecutor(new FakeAttachmentSource());
    const before = session.id;
    primaryViewState.setPhase('streaming');
    await executor.execute('newSession');
    const actual = session.id;
    expect(actual).toBe(before);
  });

  it("leaves the running turn's conversation on screen", async () => {
    const { executor, conversationState, primaryViewState } = makeExecutor(new FakeAttachmentSource());
    conversationState.addBlocks([{ type: 'response', content: 'mid-turn output' }]);
    primaryViewState.setPhase('streaming');
    await executor.execute('newSession');
    const expected = 1;
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
    const actual = commandModeState.cdEditor == null ? null : editorText(commandModeState.cdEditor);
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
    commandModeState.handleCdEditorKey({ type: 'ctrl+u' });
    for (const ch of '/nowhere') {
      commandModeState.handleCdEditorKey({ type: 'char', value: ch });
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
    const actual = commandModeState.modelEditor == null ? null : editorText(commandModeState.modelEditor);
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
    commandModeState.handleModelEditorKey({ type: 'ctrl+u' });
    for (const ch of 'claude-sonnet-5') {
      commandModeState.handleModelEditorKey({ type: 'char', value: ch });
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
    commandModeState.handleModelEditorKey({ type: 'ctrl+u' });
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
