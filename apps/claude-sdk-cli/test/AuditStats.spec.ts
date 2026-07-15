import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { CacheTtl } from '@shellicar/claude-sdk';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { AuditStats } from '../src/AuditStats.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

const AUDIT_DIR = '/home/user/.claude/audit';

function buildAuditStats(fs: IFileSystem): AuditStats {
  const services = createServiceCollection();
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(AuditStats).to(AuditStats);
  return services.buildProvider().resolve(AuditStats);
}

type LineFields = {
  input?: number;
  cacheCreation?: number; // flat usage.cache_creation_input_tokens
  cacheRead?: number;
  output?: number;
  model?: string;
  costUsd?: number; // stored derived cost
  cacheSplit?: { fiveMinute: number; oneHour: number }; // stored normalized breakdown
  ephemeral?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number }; // raw usage.cache_creation
};

function auditLine(fields: LineFields): string {
  const usage: Record<string, unknown> = {
    input_tokens: fields.input ?? 0,
    cache_creation_input_tokens: fields.cacheCreation ?? 0,
    cache_read_input_tokens: fields.cacheRead ?? 0,
    output_tokens: fields.output ?? 0,
  };
  if (fields.ephemeral !== undefined) {
    usage.cache_creation = fields.ephemeral;
  }
  const entry: Record<string, unknown> = { timestamp: '2026-01-01T00:00:00Z', model: fields.model ?? 'claude-fable-5', usage };
  if (fields.costUsd !== undefined) {
    entry.costUsd = fields.costUsd;
  }
  if (fields.cacheSplit !== undefined) {
    entry.cacheCreation = fields.cacheSplit;
  }
  return JSON.stringify(entry);
}

function fsWithAudit(id: string, lines: string[]): MemoryFileSystem {
  return new MemoryFileSystem({ [`${AUDIT_DIR}/${id}.jsonl`]: `${lines.join('\n')}\n` }, '/home/user');
}

describe('AuditStats — derive', () => {
  it('returns zero inputTokens when the id has no audit file', async () => {
    const stats = buildAuditStats(new MemoryFileSystem({}, '/home/user'));
    const expected = 0;
    const actual = (await stats.derive('missing-id', CacheTtl.OneHour)).inputTokens;
    expect(actual).toBe(expected);
  });

  it('sums inputTokens across lines', async () => {
    const stats = buildAuditStats(fsWithAudit('c1', [auditLine({ input: 100 }), auditLine({ input: 40 })]));
    const expected = 140;
    const actual = (await stats.derive('c1', CacheTtl.OneHour)).inputTokens;
    expect(actual).toBe(expected);
  });

  it('sums outputTokens across lines', async () => {
    const stats = buildAuditStats(fsWithAudit('c1', [auditLine({ output: 20 }), auditLine({ output: 5 })]));
    const expected = 25;
    const actual = (await stats.derive('c1', CacheTtl.OneHour)).outputTokens;
    expect(actual).toBe(expected);
  });

  it('takes lastContextUsed from the final line', async () => {
    const stats = buildAuditStats(fsWithAudit('c1', [auditLine({ input: 1000 }), auditLine({ input: 10, cacheCreation: 20, cacheRead: 30 })]));
    const expected = 60; // 10 + 20 + 30 from the last line only
    const actual = (await stats.derive('c1', CacheTtl.OneHour)).lastContextUsed;
    expect(actual).toBe(expected);
  });

  it('derives contextWindow from the final line model', async () => {
    const stats = buildAuditStats(fsWithAudit('c1', [auditLine({ model: 'claude-fable-5' })]));
    const expected = 1_000_000;
    const actual = (await stats.derive('c1', CacheTtl.OneHour)).contextWindow;
    expect(actual).toBe(expected);
  });

  it('reads the stored costUsd back rather than recomputing it', async () => {
    // A costUsd the pricing would never produce, so a match proves it was read, not computed.
    const stats = buildAuditStats(fsWithAudit('c1', [auditLine({ input: 1_000_000, costUsd: 999 })]));
    const expected = 999;
    const actual = (await stats.derive('c1', CacheTtl.OneHour)).costUsd;
    expect(actual).toBe(expected);
  });

  it('reconstructs cost from a stored breakdown when costUsd is absent', async () => {
    // fable-5: 5m at 12.5/M, 1h at 20/M → 1M each = 32.5
    const stats = buildAuditStats(fsWithAudit('c1', [auditLine({ model: 'claude-fable-5', cacheSplit: { fiveMinute: 1_000_000, oneHour: 1_000_000 } })]));
    const expected = 32.5;
    const actual = (await stats.derive('c1', CacheTtl.OneHour)).costUsd;
    expect(actual).toBe(expected);
  });

  it('reconstructs cost from the raw ephemeral split when no stored breakdown', async () => {
    // flat 1M all 1h → priced at the 1h rate = 20
    const stats = buildAuditStats(fsWithAudit('c1', [auditLine({ model: 'claude-fable-5', cacheCreation: 1_000_000, ephemeral: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 } })]));
    const expected = 20;
    const actual = (await stats.derive('c1', CacheTtl.OneHour)).costUsd;
    expect(actual).toBe(expected);
  });

  it('prices a legacy flat-only line at the 1h rate when 1h is configured', async () => {
    // No costUsd, no stored breakdown, no ephemeral object: flat 1M against the configured TTL.
    const stats = buildAuditStats(fsWithAudit('c1', [auditLine({ model: 'claude-fable-5', cacheCreation: 1_000_000 })]));
    const expected = 20;
    const actual = (await stats.derive('c1', CacheTtl.OneHour)).costUsd;
    expect(actual).toBe(expected);
  });

  it('prices a legacy flat-only line at the 5m rate when 5m is configured', async () => {
    const stats = buildAuditStats(fsWithAudit('c1', [auditLine({ model: 'claude-fable-5', cacheCreation: 1_000_000 })]));
    const expected = 12.5;
    const actual = (await stats.derive('c1', CacheTtl.FiveMinutes)).costUsd;
    expect(actual).toBe(expected);
  });

  it('skips a user-role line when summing inputTokens', async () => {
    const userLine = JSON.stringify({ role: 'user', content: 'hello' });
    const stats = buildAuditStats(fsWithAudit('c1', [auditLine({ input: 100 }), userLine, auditLine({ input: 40 })]));
    const expected = 140;
    const actual = (await stats.derive('c1', CacheTtl.OneHour)).inputTokens;
    expect(actual).toBe(expected);
  });

  it('skips a line with no usage field rather than throwing', async () => {
    const malformed = JSON.stringify({ model: 'claude-fable-5' });
    const stats = buildAuditStats(fsWithAudit('c1', [auditLine({ input: 100 }), malformed]));
    const expected = 100;
    const actual = (await stats.derive('c1', CacheTtl.OneHour)).inputTokens;
    expect(actual).toBe(expected);
  });

  it('skips a non-assistant, non-user role line (allowlist, not blocklist)', async () => {
    const systemLine = JSON.stringify({ role: 'system', content: 'hi' });
    const stats = buildAuditStats(fsWithAudit('c1', [auditLine({ input: 100 }), systemLine]));
    const expected = 100;
    const actual = (await stats.derive('c1', CacheTtl.OneHour)).inputTokens;
    expect(actual).toBe(expected);
  });

  it('returns zero when every line is a user-role line', async () => {
    const userLine = JSON.stringify({ role: 'user', content: 'hello' });
    const stats = buildAuditStats(fsWithAudit('c1', [userLine, userLine]));
    const expected = 0;
    const actual = (await stats.derive('c1', CacheTtl.OneHour)).inputTokens;
    expect(actual).toBe(expected);
  });
});
