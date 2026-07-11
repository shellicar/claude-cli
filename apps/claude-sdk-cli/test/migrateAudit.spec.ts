import { describe, expect, it } from 'vitest';
import { align, commit, runAuditMigration } from '../scripts/migrateAudit.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

const HOME = '/home/user';
const A = `${HOME}/.claude/audit`;
const C = `${HOME}/.claude/conversations`;
// The migration only processes <uuid>.jsonl files (it skips bak/ and stray
// names, §B.2), so fixtures use a real UUID-shaped session id.
const S = '00000000-0000-4000-8000-000000000000';

const asst = (text: string, ts = '2026-07-11T00:00:00Z') => JSON.stringify({ timestamp: ts, role: 'assistant', content: [{ type: 'text', text }], usage: {} });
const conv = (...rows: Array<['user' | 'assistant', string]>) => `${rows.map(([role, text]) => JSON.stringify({ role, content: [{ type: 'text', text }] })).join('\n')}\n`;

const roles = async (fs: MemoryFileSystem, path: string) =>
  (await fs.readFile(path))
    .trimEnd()
    .split('\n')
    .map((l) => (JSON.parse(l) as { role: string }).role);

describe('runAuditMigration', () => {
  it('inserts a user line before each assistant line', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${A}/${S}.jsonl`]: `${asst('a1')}\n${asst('a2')}\n`,
        [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1'], ['user', 'q2'], ['assistant', 'a2']),
      },
      HOME,
    );
    await runAuditMigration(fs, () => {});

    const expected = ['user', 'assistant', 'user', 'assistant'];
    const actual = await roles(fs, `${A}/${S}.jsonl`);
    expect(actual).toEqual(expected);
  });

  it('leaves the conversation file byte-identical', async () => {
    const before = conv(['user', 'q1'], ['assistant', 'a1']);
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: `${asst('a1')}\n`, [`${C}/${S}.jsonl`]: before }, HOME);
    await runAuditMigration(fs, () => {});

    const expected = before;
    const actual = await fs.readFile(`${C}/${S}.jsonl`);
    expect(actual).toBe(expected);
  });

  it('preserves the assistant-line count', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${A}/${S}.jsonl`]: `${asst('a1')}\n${asst('a2')}\n`,
        [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1'], ['user', 'q2'], ['assistant', 'a2']),
      },
      HOME,
    );
    await runAuditMigration(fs, () => {});

    const expected = 2;
    const actual = (await roles(fs, `${A}/${S}.jsonl`)).filter((r) => r === 'assistant').length;
    expect(actual).toBe(expected);
  });

  it('is a no-op on the second run', async () => {
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: `${asst('a1')}\n`, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    await runAuditMigration(fs, () => {});
    const afterFirst = await fs.readFile(`${A}/${S}.jsonl`);
    const summary = await runAuditMigration(fs, () => {});

    const expected = { file: afterFirst, migrated: 0 };
    const actual = { file: await fs.readFile(`${A}/${S}.jsonl`), migrated: summary.migrated };
    expect(actual).toEqual(expected);
  });

  it('converges: fills a freshly appended tail line, paired lines untouched', async () => {
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: `${asst('a1')}\n`, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    await runAuditMigration(fs, () => {});
    // an old CLI appends an assistant-only line; the conversation grows to match
    await fs.appendFile(`${A}/${S}.jsonl`, `${asst('a2')}\n`);
    await fs.writeFile(`${C}/${S}.jsonl`, conv(['user', 'q1'], ['assistant', 'a1'], ['user', 'q2'], ['assistant', 'a2']));
    await runAuditMigration(fs, () => {});

    const expected = ['user', 'assistant', 'user', 'assistant'];
    const actual = await roles(fs, `${A}/${S}.jsonl`);
    expect(actual).toEqual(expected);
  });

  it('backs up the pre-run original before modifying', async () => {
    const original = `${asst('a1')}\n`;
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: original, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    await runAuditMigration(fs, () => {});

    const expected = original;
    const actual = await fs.readFile(`${A}/bak/${S}.bak.1`);
    expect(actual).toBe(expected);
  });

  it('skips an old-format conversation without throwing or writing', async () => {
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: `${asst('a1')}\n`, [`${C}/${S}.jsonl`]: `${JSON.stringify({ type: 'legacy', text: 'x' })}\n` }, HOME);
    const summary = await runAuditMigration(fs, () => {});

    const expected = { skipped: 1, file: `${asst('a1')}\n` };
    const actual = { skipped: summary.skipped, file: await fs.readFile(`${A}/${S}.jsonl`) };
    expect(actual).toEqual(expected);
  });

  it('leaves an interrupted (unpaired) assistant line unpaired', async () => {
    // audit has an extra assistant line (a2x) absent from the conversation
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: `${asst('a1')}\n${asst('a2x')}\n`, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    const summary = await runAuditMigration(fs, () => {});

    const expected = { roles: ['user', 'assistant', 'assistant'], unpaired: 1 };
    const actual = { roles: await roles(fs, `${A}/${S}.jsonl`), unpaired: summary.pairing.unpaired };
    expect(actual).toEqual(expected);
  });

  it('never visits a conversation file that has no audit file', async () => {
    const fs = new MemoryFileSystem({ [`${C}/orphan.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    const summary = await runAuditMigration(fs, () => {});

    const expected = 0;
    const actual = summary.scanned;
    expect(actual).toBe(expected);
  });
});

describe('commit — safety self-check', () => {
  it('does not swap when the assistant-line count is not preserved', async () => {
    const original = `${asst('a1')}\n${asst('a2')}\n`;
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: original }, HOME);
    const auditLines = original
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l) as { role?: string });
    // A constructed output that drops an assistant line — the alignment never
    // does this, so it must be fed directly to exercise the guard.
    const broken = [auditLines[0]];
    const summary = { scanned: 0, migrated: 0, unchanged: 0, skipped: 0, failed: 0, raced: 0, corrupt: [], pairing: { exact: 0, inferred: 0, unpaired: 0 } };
    await commit(fs, A, `${A}/${S}.jsonl`, original, auditLines, broken, { exact: 0, inferred: 0, unpaired: 0 }, S, original.length, summary);

    const expected = { failed: 1, file: original };
    const actual = { failed: summary.failed, file: await fs.readFile(`${A}/${S}.jsonl`) };
    expect(actual).toEqual(expected);
  });

  it('aligns then commits a real insert through the same boundary', async () => {
    const original = `${asst('a1')}\n`;
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: original }, HOME);
    const auditLines = [JSON.parse(asst('a1')) as { role?: string }];
    const convRows = [
      { role: 'user' as const, content: [{ type: 'text', text: 'q1' }] },
      { role: 'assistant' as const, content: [{ type: 'text', text: 'a1' }] },
    ];
    const { output, counts } = align(auditLines, convRows);
    const summary = { scanned: 0, migrated: 0, unchanged: 0, skipped: 0, failed: 0, raced: 0, corrupt: [], pairing: { exact: 0, inferred: 0, unpaired: 0 } };
    await commit(fs, A, `${A}/${S}.jsonl`, original, auditLines, output, counts, S, original.length, summary);

    const expected = 1;
    const actual = summary.migrated;
    expect(actual).toBe(expected);
  });
});

describe('runAuditMigration — resilience', () => {
  const S2 = '11111111-1111-4111-8111-111111111111';

  it('names a corrupt session and still migrates the healthy one', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${A}/${S}.jsonl`]: `${asst('a1')}\n{ broken json\n`,
        [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']),
        [`${A}/${S2}.jsonl`]: `${asst('b1')}\n`,
        [`${C}/${S2}.jsonl`]: conv(['user', 'p1'], ['assistant', 'b1']),
      },
      HOME,
    );
    const summary = await runAuditMigration(fs, () => {});

    const expected = { corrupt: [S], migrated: 1 };
    const actual = { corrupt: summary.corrupt, migrated: summary.migrated };
    expect(actual).toEqual(expected);
  });

  it('leaves the corrupt file untouched', async () => {
    const original = `${asst('a1')}\n{ broken json\n`;
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: original, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    await runAuditMigration(fs, () => {});

    const expected = original;
    const actual = await fs.readFile(`${A}/${S}.jsonl`);
    expect(actual).toBe(expected);
  });

  it('skips a file that changed mid-run rather than swapping', async () => {
    const auditPath = `${A}/${S}.jsonl`;
    const fs = new RacingFileSystem(auditPath, { [auditPath]: `${asst('a1')}\n`, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    const summary = await runAuditMigration(fs, () => {});

    const expected = { raced: 1, migrated: 0 };
    const actual = { raced: summary.raced, migrated: summary.migrated };
    expect(actual).toEqual(expected);
  });

  it('keeps the concurrently-appended line when it skips a mid-run change', async () => {
    const auditPath = `${A}/${S}.jsonl`;
    const fs = new RacingFileSystem(auditPath, { [auditPath]: `${asst('a1')}\n`, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    await runAuditMigration(fs, () => {});

    // the original a1 plus the line the concurrent CLI appended — no user line inserted
    const expected = ['assistant', 'assistant'];
    const actual = await roles(fs, auditPath);
    expect(actual).toEqual(expected);
  });
});

/** A MemoryFileSystem that simulates a concurrent append: the first read of the
 *  raced path returns the original content and then appends a fresh assistant
 *  line, as an old CLI would land a turn right after the migration's snapshot
 *  read. The second stat in `commit` sees the grown size and skips the swap. */
class RacingFileSystem extends MemoryFileSystem {
  #tripped = false;
  private readonly racePath: string;

  public constructor(racePath: string, initial: Record<string, string>, home: string) {
    super(initial, home);
    this.racePath = racePath;
  }

  public override async readFile(path: string, encoding?: BufferEncoding): Promise<string> {
    const content = await super.readFile(path, encoding);
    if (path === this.racePath && !this.#tripped) {
      this.#tripped = true;
      await super.appendFile(path, `${asst('a-concurrent')}\n`);
    }
    return content;
  }
}
