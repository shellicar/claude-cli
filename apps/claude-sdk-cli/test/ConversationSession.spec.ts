import { DatabaseSync } from 'node:sqlite';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { Conversation } from '@shellicar/claude-sdk';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { logger } from '../src/logger.js';
import { ConversationSession } from '../src/model/ConversationSession.js';
import { SqliteSessionStore } from '../src/persistence/SqliteSessionStore.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

// A fresh in-memory session store per build, unless a test hands one in to seed or inspect it.
const memoryStore = (): SqliteSessionStore => new SqliteSessionStore(new DatabaseSync(':memory:'), logger);

// ConversationSession injects IFileSystem + Conversation + SqliteSessionStore, so build it through a container.
function buildSession(fs: IFileSystem, conversation: Conversation, sessionStore: SqliteSessionStore = memoryStore()): ConversationSession {
  const services = createServiceCollection();
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(Conversation).to(Conversation, () => conversation);
  services.register(SqliteSessionStore).to(SqliteSessionStore, () => sessionStore);
  services.register(ConversationSession).to(ConversationSession);
  return services.buildProvider().resolve(ConversationSession);
}

const HOME = '/home/user';
const CWD = '/project';

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

describe('ConversationSession — load', () => {
  it('generates an ID when no marker file exists', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const session = buildSession(fs, new Conversation());
    await session.load();

    const expected = true;
    const actual = session.id.length > 0;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// createNew
// ---------------------------------------------------------------------------

describe('ConversationSession — createNew', () => {
  it('generates a different ID', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const session = buildSession(fs, new Conversation());
    await session.load();
    const firstId = session.id;
    await session.createNew();

    const expected = false;
    const actual = session.id === firstId;
    expect(actual).toBe(expected);
  });

  it('clears the conversation', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const conversation = new Conversation();
    const session = buildSession(fs, conversation);
    await session.load();
    conversation.push({ role: 'user', content: [{ type: 'text', text: 'hello' }] });
    await session.createNew();

    const expected = 0;
    const actual = conversation.messages.length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// save
// ---------------------------------------------------------------------------

describe('ConversationSession — save', () => {
  it('writes history that load can restore', async () => {
    const store = memoryStore();
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const conversation = new Conversation();
    const session = buildSession(fs, conversation, store);
    await session.load();
    conversation.push({ role: 'user', content: [{ type: 'text', text: 'hello' }] });
    await session.saveSession();
    await session.saveConversation();

    const restoredConversation = new Conversation();
    const restoredSession = buildSession(fs, restoredConversation, store);
    await restoredSession.load();

    const expected = 1;
    const actual = restoredConversation.messages.length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// resume
// ---------------------------------------------------------------------------

describe('ConversationSession — resume', () => {
  it('adopts the supplied id when no history file exists', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const session = buildSession(fs, new Conversation());
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    await session.resume(id);

    const expected = id;
    const actual = session.id;
    expect(actual).toBe(expected);
  });

  it('loads history from ~/.claude/conversations/{id}.jsonl when present', async () => {
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const historyPath = `${HOME}/.claude/conversations/${id}.jsonl`;
    const message = { role: 'user', content: [{ type: 'text', text: 'hello' }] };
    const fs = new MemoryFileSystem({ [historyPath]: `${JSON.stringify(message)}\n` }, HOME, CWD);
    const conversation = new Conversation();
    const session = buildSession(fs, conversation);
    await session.resume(id);

    const expected = 1;
    const actual = conversation.messages.length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// turnCount
// ---------------------------------------------------------------------------

describe('ConversationSession — turnCount', () => {
  function userMsg() {
    return { role: 'user' as const, content: [{ type: 'text' as const, text: 'hello' }] };
  }
  function assistantMsg() {
    return { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'reply' }] };
  }
  function compactionMsg() {
    return { role: 'assistant' as const, content: [{ type: 'compaction' as const, content: 'summary' }] };
  }

  it('reports zero for a fresh session', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const session = buildSession(fs, new Conversation());
    await session.load();

    const expected = 0;
    const actual = session.turnCount;
    expect(actual).toBe(expected);
  });

  it('counts a single assistant message as one turn', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const conversation = new Conversation();
    const session = buildSession(fs, conversation);
    await session.load();
    conversation.push(userMsg());
    conversation.push(assistantMsg());

    const expected = 1;
    const actual = session.turnCount;
    expect(actual).toBe(expected);
  });

  it('does not count user messages as turns', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const conversation = new Conversation();
    const session = buildSession(fs, conversation);
    await session.load();
    conversation.push(userMsg());

    const expected = 0;
    const actual = session.turnCount;
    expect(actual).toBe(expected);
  });

  it('counts each assistant message as a separate turn', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const conversation = new Conversation();
    const session = buildSession(fs, conversation);
    await session.load();
    conversation.push(userMsg());
    conversation.push(assistantMsg());
    conversation.push(userMsg());
    conversation.push(assistantMsg());

    const expected = 2;
    const actual = session.turnCount;
    expect(actual).toBe(expected);
  });

  it('counts assistant messages restored via setHistory', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const conversation = new Conversation();
    const session = buildSession(fs, conversation);
    await session.load();
    conversation.setHistory([userMsg(), assistantMsg(), assistantMsg()].map((msg) => ({ msg })));

    const expected = 2;
    const actual = session.turnCount;
    expect(actual).toBe(expected);
  });

  it('counts a compaction message as a turn', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const conversation = new Conversation();
    const session = buildSession(fs, conversation);
    await session.load();
    conversation.push(userMsg());
    conversation.push(assistantMsg());
    conversation.push(compactionMsg());

    const expected = 2;
    const actual = session.turnCount;
    expect(actual).toBe(expected);
  });

  it('reads zero after createNew clears the conversation', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const conversation = new Conversation();
    const session = buildSession(fs, conversation);
    await session.load();
    conversation.push(userMsg());
    conversation.push(assistantMsg());
    await session.createNew();

    const expected = 0;
    const actual = session.turnCount;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// saveConversation — atomic write + reload floor
// ---------------------------------------------------------------------------

describe('ConversationSession — saveConversation', () => {
  it('leaves no temp file behind after a save', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const conversation = new Conversation();
    const session = buildSession(fs, conversation);
    await session.load();
    conversation.push({ role: 'user', content: [{ type: 'text', text: 'hi' }] });
    await session.saveConversation();

    const entries = await fs.readdir(`${HOME}/.claude/conversations`);
    const actual = entries.some((e) => e.name.endsWith('.tmp'));
    expect(actual).toBe(false);
  });

  it('restores a conversation whose tail is an unanswered assistant tool_use', async () => {
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const historyPath = `${HOME}/.claude/conversations/${id}.jsonl`;
    const userMsg = { role: 'user', content: [{ type: 'text', text: 'hi' }] };
    const assistantToolUse = { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'ReadFile', input: {} }] };
    const seeded = `${JSON.stringify(userMsg)}\n${JSON.stringify(assistantToolUse)}\n`;
    const fs = new MemoryFileSystem({ [historyPath]: seeded }, HOME, CWD);
    const conversation = new Conversation();
    const session = buildSession(fs, conversation);
    await session.resume(id);

    const expected = 2;
    const actual = conversation.messages.length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// store-backed save/resolve (the mechanism the Builder wires in)
// ---------------------------------------------------------------------------

describe('ConversationSession — store-backed save', () => {
  it('appends the current session association to the store on save', async () => {
    const store = memoryStore();
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const session = buildSession(fs, new Conversation(), store);
    await session.load();
    await session.saveSession();

    const expected = session.id;
    const actual = store.mostRecentByCwd(CWD);
    expect(actual).toBe(expected);
  });
});

describe('ConversationSession — store-backed resolve', () => {
  it('resolves the resume target from the store for the current cwd', async () => {
    const savedId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const store = memoryStore();
    store.append(savedId, CWD, '2026-07-05T00:00:00Z');
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const session = buildSession(fs, new Conversation(), store);
    await session.load();

    const expected = savedId;
    const actual = session.id;
    expect(actual).toBe(expected);
  });

  it('mints a fresh id when the store has no session for the cwd', async () => {
    const store = memoryStore();
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const session = buildSession(fs, new Conversation(), store);
    await session.load();

    const expected = true;
    const actual = session.id.length > 0;
    expect(actual).toBe(expected);
  });
});
