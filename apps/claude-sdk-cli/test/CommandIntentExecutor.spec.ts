import { Conversation } from '@shellicar/claude-sdk';
import { describe, expect, it } from 'vitest';
import { CommandIntentExecutor } from '../src/controller/CommandIntentExecutor.js';
import type { AttachmentSource } from '../src/model/AttachmentSource.js';
import { CommandModeState } from '../src/model/CommandModeState.js';
import { ConversationSession } from '../src/model/ConversationSession.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { FakeAttachmentSource } from './FakeAttachmentSource.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

function makeExecutor(source: AttachmentSource) {
  const commandModeState = new CommandModeState();
  const conversationState = new ConversationState();
  const session = new ConversationSession(new MemoryFileSystem({}, '/home/user', '/test'), new Conversation());
  const executor = new CommandIntentExecutor(commandModeState, conversationState, session, source);
  return { executor, commandModeState, conversationState, session };
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
