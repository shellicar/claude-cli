import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { AuditWriter } from '../src/AuditWriter.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

// AuditWriter now derives its dir as `${fs.homedir()}/.claude/audit`; with the
// fake homedir '/home/user' that is this path.
const AUDIT_DIR = '/home/user/.claude/audit';

// AuditWriter injects IFileSystem, so build it through a container with the fake fs.
function buildAuditWriter(fs: IFileSystem): AuditWriter {
  const services = createServiceCollection();
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(AuditWriter).to(AuditWriter);
  return services.buildProvider().resolve(AuditWriter);
}

function makeMessage(text = 'Hello'): BetaMessage {
  return {
    id: 'msg_01',
    container: null,
    content: [{ type: 'text', text }],
    context_management: null,
    model: 'claude-sonnet-4-20250514',
    role: 'assistant',
    stop_details: null,
    stop_reason: 'end_turn',
    stop_sequence: null,
    type: 'message',
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
  } as BetaMessage;
}

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

describe('AuditWriter — write', () => {
  it('creates a file at <auditDir>/<id>.jsonl', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-123', makeMessage());

    await new Promise((r) => setTimeout(r, 10));

    const expected = true;
    const actual = await fs.exists(`${AUDIT_DIR}/conv-123.jsonl`);
    expect(actual).toBe(expected);
  });

  it('appends one line per call', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-1', makeMessage('first'));
    writer.write('conv-1', makeMessage('second'));

    await new Promise((r) => setTimeout(r, 10));

    const content = await fs.readFile(`${AUDIT_DIR}/conv-1.jsonl`);
    const expected = 2;
    const actual = content.trimEnd().split('\n').length;
    expect(actual).toBe(expected);
  });

  it('writes each line as valid JSON', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-2', makeMessage());

    await new Promise((r) => setTimeout(r, 10));

    const content = await fs.readFile(`${AUDIT_DIR}/conv-2.jsonl`);
    const line = content.trimEnd();
    const expected = true;
    const actual = (() => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    })();
    expect(actual).toBe(expected);
  });

  it('accumulates lines in the same file for the same ID', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-same', makeMessage('one'));
    writer.write('conv-same', makeMessage('two'));
    writer.write('conv-same', makeMessage('three'));

    await new Promise((r) => setTimeout(r, 10));

    const content = await fs.readFile(`${AUDIT_DIR}/conv-same.jsonl`);
    const expected = 3;
    const actual = content.trimEnd().split('\n').length;
    expect(actual).toBe(expected);
  });

  it('creates a separate file for each distinct ID', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-a', makeMessage('alpha'));
    writer.write('conv-b', makeMessage('beta'));

    await new Promise((r) => setTimeout(r, 10));

    const existsA = await fs.exists(`${AUDIT_DIR}/conv-a.jsonl`);
    const existsB = await fs.exists(`${AUDIT_DIR}/conv-b.jsonl`);
    const expected = true;
    const actual = existsA && existsB;
    expect(actual).toBe(expected);
  });
});
