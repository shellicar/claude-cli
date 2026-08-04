import { DatabaseSync } from 'node:sqlite';
import { Clock, Instant, ZoneId } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { Conversation, IConversation } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { AuditStats } from '../src/AuditStats.js';
import { IAgentPresence } from '../src/agent/AgentPresence.js';
import { IConvServe } from '../src/conv/ConvServe.js';
import { logger } from '../src/logger.js';
import { ConversationSession, IConversationSession } from '../src/model/ConversationSession.js';
import { ConversationState, IConversationState } from '../src/model/ConversationState.js';
import { ISystemIdentity } from '../src/model/ISystemIdentity.js';
import { ModelSettings } from '../src/model/ModelSettings.js';
import { IPrimaryViewState, PrimaryViewState } from '../src/model/PrimaryViewState.js';
import { StatusState } from '../src/model/StatusState.js';
import { SystemIdentity } from '../src/model/SystemIdentity.js';
import { ISqliteSessionStore, SqliteSessionStore } from '../src/persistence/SqliteSessionStore.js';
import { ICacheWarning } from '../src/setup/CacheWarning.js';
import { ConversationSwitcher, IConversationSwitcher } from '../src/setup/ConversationSwitcher.js';
import { IWorkspace } from '../src/workspace/Workspace.js';
import { FakeCacheWarning } from './FakeCacheWarning.js';
import { FakeModelSettings } from './FakeModelSettings.js';
import { FakeWorkspace } from './FakeWorkspace.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';
import { MemoryObjectStore } from './MemoryObjectStore.js';

const EXISTING_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

/** Test double: a logger that discards everything, so the switcher resolves without the app's logger. */
const noopLogger: ILogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const conversationLine = (role: 'user' | 'assistant', text: string): string => JSON.stringify({ role, content: [{ type: 'text', text }] });

/** Builds the switcher over in-memory everything, with `EXISTING_ID` already on disk as a two-message conversation. */
function makeSwitcher(workspace = new FakeWorkspace()) {
  const files: Record<string, string> = {
    [`/home/user/.claude/conversations/${EXISTING_ID}.jsonl`]: [conversationLine('user', 'the existing ask'), conversationLine('assistant', 'the existing reply')].join('\n'),
  };
  const fs = new MemoryFileSystem(files, '/home/user', '/test');
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(IFileSystem)
    .using(() => fs)
    .asSelf();
  services
    .register(ILogger)
    .using(() => noopLogger)
    .asSelf();
  services
    .register(Clock)
    .using(() => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC))
    .asSelf();
  services.register(Conversation).asSelf().as(IConversation);
  services.register(ConversationState).asSelf().as(IConversationState);
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
    .register(ModelSettings)
    .using(() => new FakeModelSettings())
    .asSelf();
  services
    .register(ICacheWarning)
    .using(() => new FakeCacheWarning())
    .asSelf();
  services.register(PrimaryViewState).asSelf().as(IPrimaryViewState);
  services
    .register(ConfigLoader)
    .using(() => ({ config: { historyReplay: { enabled: true, showThinking: false } } }) as unknown as ConfigLoader<never>)
    .asSelf();
  services
    .register(StatusState)
    .using(() => new StatusState('test'))
    .asSelf();
  services.register(AuditStats).asSelf();
  services
    .register(IConvServe)
    .using(() => ({ bind: () => {} }))
    .asSelf();
  services
    .register(IAgentPresence)
    .using(() => ({ instanceId: 'inst-test', world: 'test', boot: () => {}, attach: () => {}, detach: () => {}, stop: () => {} }))
    .asSelf();
  services
    .register(FakeWorkspace)
    .using(() => workspace)
    .as(IWorkspace);
  services.register(ConversationSwitcher).asSelf().as(IConversationSwitcher);
  const provider = services.buildProvider();
  return {
    switcher: provider.resolve(ConversationSwitcher),
    session: provider.resolve(ConversationSession),
    conversation: provider.resolve(Conversation),
    conversationState: provider.resolve(ConversationState),
    statusState: provider.resolve(StatusState),
    primaryViewState: provider.resolve(PrimaryViewState),
  };
}

describe('ConversationSwitcher — switchTo', () => {
  it('adopts the target id as the live conversation', async () => {
    const { switcher, session } = makeSwitcher();
    await switcher.switchTo(EXISTING_ID);
    const expected = EXISTING_ID;
    const actual = session.id;
    expect(actual).toBe(expected);
  });

  it('loads the target conversation history', async () => {
    const { switcher, conversation } = makeSwitcher();
    await switcher.switchTo(EXISTING_ID);
    const expected = 2;
    const actual = conversation.messages.length;
    expect(actual).toBe(expected);
  });

  it('replaces the transcript of the conversation being left', async () => {
    const { switcher, conversationState } = makeSwitcher();
    conversationState.addBlocks([{ type: 'meta', content: 'from the previous conversation' }]);
    await switcher.switchTo(EXISTING_ID);
    const actual = conversationState.sealedBlocks.map((block) => block.content).join('\n');
    expect(actual).not.toContain('from the previous conversation');
  });

  it('puts the adopted conversation on screen', async () => {
    const { switcher, conversationState } = makeSwitcher();
    await switcher.switchTo(EXISTING_ID);
    const actual = conversationState.sealedBlocks.map((block) => block.content).join('\n');
    expect(actual).toContain('the existing ask');
  });

  it('shows the replies of the adopted conversation, not only what was asked', async () => {
    const { switcher, conversationState } = makeSwitcher();
    await switcher.switchTo(EXISTING_ID);
    const actual = conversationState.sealedBlocks.map((block) => block.content).join('\n');
    expect(actual).toContain('the existing reply');
  });

  it('leaves the transcript empty when arriving at a conversation with no history', async () => {
    const { switcher, conversationState } = makeSwitcher();
    conversationState.addBlocks([{ type: 'meta', content: 'from the previous conversation' }]);
    await switcher.switchTo(OTHER_ID);
    const expected = 0;
    const actual = conversationState.sealedBlocks.length;
    expect(actual).toBe(expected);
  });

  it('records the target under the current directory so it resumes there', async () => {
    const { switcher, session } = makeSwitcher();
    await switcher.switchTo(EXISTING_ID);
    await session.load();
    const expected = EXISTING_ID;
    const actual = session.id;
    expect(actual).toBe(expected);
  });

  it('reads empty status figures for a conversation with no audit', async () => {
    const { switcher, statusState } = makeSwitcher();
    await switcher.switchTo(EXISTING_ID);
    const expected = 0;
    const actual = statusState.totalCostUsd;
    expect(actual).toBe(expected);
  });

  it('leaves the transcript untouched when the target is already live', async () => {
    const { switcher, conversationState, session } = makeSwitcher();
    await switcher.switchTo(EXISTING_ID);
    const settled = conversationState.sealedBlocks.length;
    conversationState.addBlocks([{ type: 'meta', content: 'said after arriving' }]);
    await switcher.switchTo(session.id);
    const expected = settled + 1;
    const actual = conversationState.sealedBlocks.length;
    expect(actual).toBe(expected);
  });

  it('starts empty when the target has no stored history', async () => {
    const { switcher, conversation } = makeSwitcher();
    await switcher.switchTo(OTHER_ID);
    const expected = 0;
    const actual = conversation.messages.length;
    expect(actual).toBe(expected);
  });

  /** A conversation can be listed with no stored history: the session store records an id as soon as
   *  it is live, so an id that never took a turn has a row and no file. Arriving at one must leave
   *  nothing of the conversation being left behind, or its messages become the new conversation's and
   *  are written back out under the new id. */
  it('carries nothing of the previous conversation into a target with no stored history', async () => {
    const { switcher, conversation } = makeSwitcher();
    await switcher.switchTo(EXISTING_ID);
    await switcher.switchTo(OTHER_ID);
    const expected = 0;
    const actual = conversation.messages.length;
    expect(actual).toBe(expected);
  });
});

describe('ConversationSwitcher — createNew', () => {
  it('moves off the conversation it was on', async () => {
    const { switcher, session } = makeSwitcher();
    await switcher.switchTo(EXISTING_ID);
    await switcher.createNew();
    const actual = session.id;
    expect(actual).not.toBe(EXISTING_ID);
  });

  it('starts the new conversation with no history', async () => {
    const { switcher, conversation } = makeSwitcher();
    await switcher.switchTo(EXISTING_ID);
    await switcher.createNew();
    const expected = 0;
    const actual = conversation.messages.length;
    expect(actual).toBe(expected);
  });

  it('clears the transcript', async () => {
    const { switcher, conversationState } = makeSwitcher();
    conversationState.addBlocks([{ type: 'meta', content: 'from the previous conversation' }]);
    await switcher.createNew();
    const expected = 0;
    const actual = conversationState.sealedBlocks.length;
    expect(actual).toBe(expected);
  });
});

// The scratchpad belongs to the conversation, so moving to a different one has to create and check
// it again. A refusal surfacing in the transcript is the observable proof that happened, and that a
// scratchpad the machine will not give us costs a notice rather than the move.
describe('ConversationSwitcher — the scratchpad follows the conversation', () => {
  const refusing = () => new FakeWorkspace({ refusal: { reason: '/tmp/claude-501 is owned by another user', remedy: 'Nothing on your side can change that; the scratchpad stays off.' } });

  it('reports a refused scratchpad when switching to another conversation', async () => {
    const { switcher, conversationState } = makeSwitcher(refusing());
    await switcher.switchTo(EXISTING_ID);
    const actual = conversationState.sealedBlocks.concat(conversationState.activeBlock ? [conversationState.activeBlock] : []).map((b) => b.content);
    expect(actual.join('\n')).toContain('scratchpad unavailable');
  });

  it('reports a refused scratchpad when starting a new conversation', async () => {
    const { switcher, conversationState } = makeSwitcher(refusing());
    await switcher.createNew();
    const actual = conversationState.sealedBlocks.concat(conversationState.activeBlock ? [conversationState.activeBlock] : []).map((b) => b.content);
    expect(actual.join('\n')).toContain('scratchpad unavailable');
  });

  it('says nothing when the scratchpad is available', async () => {
    const { switcher, conversationState } = makeSwitcher();
    await switcher.switchTo(EXISTING_ID);
    const actual = conversationState.sealedBlocks.concat(conversationState.activeBlock ? [conversationState.activeBlock] : []).map((b) => b.content);
    expect(actual.join('\n')).not.toContain('scratchpad');
  });
});
