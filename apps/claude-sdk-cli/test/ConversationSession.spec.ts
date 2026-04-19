import { Conversation } from '@shellicar/claude-sdk';
import { MemoryFileSystem } from '@shellicar/claude-sdk-tools/fs';
import { describe, expect, it } from 'vitest';
import { ConversationSession } from '../src/model/ConversationSession.js';

const HOME = '/home/user';
const CWD = '/project';
const MARKER_FILE = `${CWD}/.claude/.sdk-conversation-id`;

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

describe('ConversationSession — load', () => {
  it('generates an ID when no marker file exists', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const session = new ConversationSession(fs, new Conversation());
    await session.load();

    const expected = true;
    const actual = session.id.length > 0;
    expect(actual).toBe(expected);
  });

  it('does not write marker file on load when no marker exists', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const session = new ConversationSession(fs, new Conversation());
    await session.load();

    const expected = false;
    const actual = await fs.exists(MARKER_FILE);
    expect(actual).toBe(expected);
  });

  it('restores the same ID from a previous run', async () => {
    const savedId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const fs = new MemoryFileSystem({ [MARKER_FILE]: savedId }, HOME, CWD);
    const session = new ConversationSession(fs, new Conversation());
    await session.load();

    const expected = savedId;
    const actual = session.id;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// createNew
// ---------------------------------------------------------------------------

describe('ConversationSession — createNew', () => {
  it('generates a different ID', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const session = new ConversationSession(fs, new Conversation());
    await session.load();
    const firstId = session.id;
    await session.createNew();

    const expected = false;
    const actual = session.id === firstId;
    expect(actual).toBe(expected);
  });

  it('does not write new ID to marker before save', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const session = new ConversationSession(fs, new Conversation());
    await session.load();
    const firstId = session.id;
    await session.createNew();

    // marker exists (written by save() for the old session), but still holds the old ID
    const markerContent = await fs.readFile(MARKER_FILE);
    expect(markerContent).toBe(firstId);
    expect(session.id).not.toBe(firstId);
  });

  it('writes new ID to marker after save', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const session = new ConversationSession(fs, new Conversation());
    await session.load();
    await session.createNew();
    await session.save();

    const expected = session.id;
    const actual = await fs.readFile(MARKER_FILE);
    expect(actual).toBe(expected);
  });

  it('clears the conversation', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const conversation = new Conversation();
    const session = new ConversationSession(fs, conversation);
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
  it('writes marker file on save', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const session = new ConversationSession(fs, new Conversation());
    await session.load();
    await session.save();

    const expected = true;
    const actual = await fs.exists(MARKER_FILE);
    expect(actual).toBe(expected);
  });

  it('writes history that load can restore', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const conversation = new Conversation();
    const session = new ConversationSession(fs, conversation);
    await session.load();
    conversation.push({ role: 'user', content: [{ type: 'text', text: 'hello' }] });
    await session.save();

    const restoredConversation = new Conversation();
    const restoredSession = new ConversationSession(fs, restoredConversation);
    await restoredSession.load();

    const expected = 1;
    const actual = restoredConversation.messages.length;
    expect(actual).toBe(expected);
  });
});
