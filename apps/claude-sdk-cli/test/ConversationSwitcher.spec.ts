import { DatabaseSync } from 'node:sqlite';
import { Clock, Instant, ZoneId } from '@js-joda/core';
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
import { StatusState } from '../src/model/StatusState.js';
import { SystemIdentity } from '../src/model/SystemIdentity.js';
import { ISqliteSessionStore, SqliteSessionStore } from '../src/persistence/SqliteSessionStore.js';
import { ConversationSwitcher, IConversationSwitcher } from '../src/setup/ConversationSwitcher.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';
import { MemoryObjectStore } from './MemoryObjectStore.js';

const EXISTING_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

/** Test double: a logger that discards everything, so the switcher resolves without the app's logger. */
const noopLogger: ILogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const conversationLine = (role: 'user' | 'assistant', text: string): string => JSON.stringify({ role, content: [{ type: 'text', text }] });

/** Builds the switcher over in-memory everything, with `EXISTING_ID` already on disk as a two-message conversation. */
function makeSwitcher() {
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
  services.register(ConversationSwitcher).asSelf().as(IConversationSwitcher);
  const provider = services.buildProvider();
  return {
    switcher: provider.resolve(ConversationSwitcher),
    session: provider.resolve(ConversationSession),
    conversation: provider.resolve(Conversation),
    conversationState: provider.resolve(ConversationState),
    statusState: provider.resolve(StatusState),
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

  it('clears the transcript of the conversation being left', async () => {
    const { switcher, conversationState } = makeSwitcher();
    conversationState.addBlocks([{ type: 'meta', content: 'from the previous conversation' }]);
    await switcher.switchTo(EXISTING_ID);
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
    conversationState.addBlocks([{ type: 'meta', content: 'said after arriving' }]);
    await switcher.switchTo(session.id);
    const expected = 1;
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
