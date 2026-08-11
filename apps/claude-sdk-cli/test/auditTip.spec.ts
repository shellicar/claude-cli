import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { AuditTip } from '../src/conversations/auditTip.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

const PATH = '/home/user/.claude/audit/conv-1.jsonl';

const line = (id: string): string => JSON.stringify({ role: 'user', id, turnId: 't1', queryId: 'q1', timestamp: '2026-08-11T00:00:00.000Z', content: [] });

function buildAuditTip(files: Record<string, string>): AuditTip {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(IFileSystem)
    .using(() => new MemoryFileSystem(files, '/home/user'))
    .asSelf();
  services.register(AuditTip).asSelf();
  return services.buildProvider().resolve(AuditTip);
}

describe('AuditTip', () => {
  // This id is what a resumed conversation states as its position, and what a `say` from another
  // client has to match to be accepted.
  it('reads the id of the last recorded message', async () => {
    const tip = buildAuditTip({ [PATH]: `${line('m1')}\n${line('m2')}` });

    const expected = 'm2';
    const actual = await tip.read('conv-1');
    expect(actual).toBe(expected);
  });

  // A conversation nobody has spoken in has no position to state, which is a legitimate premise on
  // the wire rather than a missing answer.
  it('reads no id for a conversation with no audit file', async () => {
    const tip = buildAuditTip({});
    expect(await tip.read('conv-1')).toBeNull();
  });

  // The audit holds lines written before messages carried ids. They are not the position of anything
  // a client saw, so the last one that is has to be found past them.
  it('reads past a line carrying no id', async () => {
    const tip = buildAuditTip({ [PATH]: `${line('m1')}\n${JSON.stringify({ role: 'assistant', content: [] })}` });

    const expected = 'm1';
    const actual = await tip.read('conv-1');
    expect(actual).toBe(expected);
  });

  // The audit is appended without waiting for the write, so a process killed mid-append leaves a
  // half-written last line. This runs on the startup path: throwing means the CLI never opens the
  // conversation at all.
  it('reads past a line that will not parse', async () => {
    const tip = buildAuditTip({ [PATH]: `${line('m1')}\n{"role":"user","id":"m2` });

    const expected = 'm1';
    const actual = await tip.read('conv-1');
    expect(actual).toBe(expected);
  });
});
