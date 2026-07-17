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
    await runAuditMigration(fs, () => {}, true);

    const expected = ['user', 'assistant', 'user', 'assistant'];
    const actual = await roles(fs, `${A}/${S}.jsonl`);
    expect(actual).toEqual(expected);
  });

  it('leaves the conversation file byte-identical', async () => {
    const before = conv(['user', 'q1'], ['assistant', 'a1']);
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: `${asst('a1')}\n`, [`${C}/${S}.jsonl`]: before }, HOME);
    await runAuditMigration(fs, () => {}, true);

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
    await runAuditMigration(fs, () => {}, true);

    const expected = 2;
    const actual = (await roles(fs, `${A}/${S}.jsonl`)).filter((r) => r === 'assistant').length;
    expect(actual).toBe(expected);
  });

  it('is a no-op on the second run', async () => {
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: `${asst('a1')}\n`, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    await runAuditMigration(fs, () => {}, true);
    const afterFirst = await fs.readFile(`${A}/${S}.jsonl`);
    const summary = await runAuditMigration(fs, () => {}, true);

    const expected = { file: afterFirst, migrated: 0 };
    const actual = { file: await fs.readFile(`${A}/${S}.jsonl`), migrated: summary.migrated };
    expect(actual).toEqual(expected);
  });

  it('converges a conversation that opens on an assistant row', async () => {
    // The conversation's first row is an assistant (no preceding user): there is
    // no user message to reconstruct, so none is inserted. The assistant must
    // still be stamped with its own turnId so `needsWork` marks the file done —
    // otherwise it stays v1 and the migration re-reads and re-aligns it every run
    // instead of settling. Prove both halves: the first run stamps the assistant
    // (v2), and the second run is a no-op.
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: `${asst('a1')}\n`, [`${C}/${S}.jsonl`]: conv(['assistant', 'a1']) }, HOME);
    await runAuditMigration(fs, () => {}, true);
    const afterFirst = await fs.readFile(`${A}/${S}.jsonl`);
    const stamped = (JSON.parse(afterFirst.trim()) as { turnId?: string }).turnId !== undefined;
    const summary = await runAuditMigration(fs, () => {}, true);

    const expected = { stamped: true, file: afterFirst, migrated: 0 };
    const actual = { stamped, file: await fs.readFile(`${A}/${S}.jsonl`), migrated: summary.migrated };
    expect(actual).toEqual(expected);
  });

  it('converges: fills a freshly appended tail line, paired lines untouched', async () => {
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: `${asst('a1')}\n`, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    await runAuditMigration(fs, () => {}, true);
    // an old CLI appends an assistant-only line; the conversation grows to match
    await fs.appendFile(`${A}/${S}.jsonl`, `${asst('a2')}\n`);
    await fs.writeFile(`${C}/${S}.jsonl`, conv(['user', 'q1'], ['assistant', 'a1'], ['user', 'q2'], ['assistant', 'a2']));
    await runAuditMigration(fs, () => {}, true);

    const expected = ['user', 'assistant', 'user', 'assistant'];
    const actual = await roles(fs, `${A}/${S}.jsonl`);
    expect(actual).toEqual(expected);
  });

  it('backs up the pre-run original before modifying', async () => {
    const original = `${asst('a1')}\n`;
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: original, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    await runAuditMigration(fs, () => {}, true);

    const expected = original;
    const actual = await fs.readFile(`${A}/bak/${S}.bak.1`);
    expect(actual).toBe(expected);
  });

  it('skips an old-format conversation without throwing or writing', async () => {
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: `${asst('a1')}\n`, [`${C}/${S}.jsonl`]: `${JSON.stringify({ type: 'legacy', text: 'x' })}\n` }, HOME);
    const summary = await runAuditMigration(fs, () => {}, true);

    const expected = { skipped: 1, file: `${asst('a1')}\n` };
    const actual = { skipped: summary.skipped, file: await fs.readFile(`${A}/${S}.jsonl`) };
    expect(actual).toEqual(expected);
  });

  it('leaves an interrupted (unpaired) assistant line unpaired', async () => {
    // audit has an extra assistant line (a2x) absent from the conversation
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: `${asst('a1')}\n${asst('a2x')}\n`, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    const summary = await runAuditMigration(fs, () => {}, true);

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

describe('align — match key', () => {
  it('matches a pure tool_use turn by its tool_use id, not its (empty) text', () => {
    // A pure tool_use turn carries no text, so text-only keying would return ''
    // and, guarded by key !== '', never pair it. Keying on the tool_use id pairs
    // it against the conversation's tool_use row (id byte-identical across the two
    // files, poc-design §2.3) — the inserted user line proves the match.
    const auditLines = [{ role: 'assistant', timestamp: 't', content: [{ type: 'tool_use', id: 'toolu_1', name: 'X', input: {} }] }];
    const convRows = [
      { role: 'user' as const, content: [{ type: 'text', text: 'q1' }] },
      { role: 'assistant' as const, content: [{ type: 'tool_use', id: 'toolu_1', name: 'X', input: {} }] },
    ];

    const expected = ['user', 'assistant'];
    const actual = align(auditLines, convRows).output.map((l) => l.role);
    expect(actual).toEqual(expected);
  });

  it('never pairs a turn with neither text nor tool_use (an empty key)', () => {
    // Both the audit line and the conversation row at the cursor have empty
    // content. Text-only keying would compare '' === '' and wrongly consume the
    // row, shifting every later insert; the empty-key guard leaves it unpaired.
    const auditLines = [{ role: 'assistant', timestamp: 't', content: [] }];
    const convRows = [
      { role: 'user' as const, content: [{ type: 'text', text: 'q1' }] },
      { role: 'assistant' as const, content: [] },
    ];

    const expected = { roles: ['assistant'], unpaired: 1 };
    const { output, counts } = align(auditLines, convRows);
    const actual = { roles: output.map((l) => l.role), unpaired: counts.unpaired };
    expect(actual).toEqual(expected);
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
    const summary = { scanned: 0, migrated: 0, unchanged: 0, skipped: 0, failed: 0, raced: 0, corrupt: [], pairing: { exact: 0, unpaired: 0 }, plan: [] };
    await commit(fs, A, `${A}/${S}.jsonl`, original, auditLines, broken, { exact: 0, unpaired: 0 }, S, original.length, true, summary);

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
    const summary = { scanned: 0, migrated: 0, unchanged: 0, skipped: 0, failed: 0, raced: 0, corrupt: [], pairing: { exact: 0, unpaired: 0 }, plan: [] };
    await commit(fs, A, `${A}/${S}.jsonl`, original, auditLines, output, counts, S, original.length, true, summary);

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
    const summary = await runAuditMigration(fs, () => {}, true);

    const expected = { corrupt: [S], migrated: 1 };
    const actual = { corrupt: summary.corrupt, migrated: summary.migrated };
    expect(actual).toEqual(expected);
  });

  it('leaves the corrupt file untouched', async () => {
    const original = `${asst('a1')}\n{ broken json\n`;
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: original, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    await runAuditMigration(fs, () => {}, true);

    const expected = original;
    const actual = await fs.readFile(`${A}/${S}.jsonl`);
    expect(actual).toBe(expected);
  });

  it('skips a file that changed mid-run rather than swapping', async () => {
    const auditPath = `${A}/${S}.jsonl`;
    const fs = new RacingFileSystem(auditPath, { [auditPath]: `${asst('a1')}\n`, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    const summary = await runAuditMigration(fs, () => {}, true);

    const expected = { raced: 1, migrated: 0 };
    const actual = { raced: summary.raced, migrated: summary.migrated };
    expect(actual).toEqual(expected);
  });

  it('keeps the concurrently-appended line when it skips a mid-run change', async () => {
    const auditPath = `${A}/${S}.jsonl`;
    const fs = new RacingFileSystem(auditPath, { [auditPath]: `${asst('a1')}\n`, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    await runAuditMigration(fs, () => {}, true);

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

describe('runAuditMigration — dry run by default', () => {
  it('leaves every audit file untouched on a bare run', async () => {
    const original = `${asst('a1')}\n`;
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: original, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    await runAuditMigration(fs, () => {});

    const expected = original;
    const actual = await fs.readFile(`${A}/${S}.jsonl`);
    expect(actual).toBe(expected);
  });

  it('writes no backup on a bare run', async () => {
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: `${asst('a1')}\n`, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    await runAuditMigration(fs, () => {});

    const expected = false;
    const actual = await fs.exists(`${A}/bak/${S}.bak.1`);
    expect(actual).toBe(expected);
  });

  it('reports per file the user lines a real run would insert', async () => {
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: `${asst('a1')}\n`, [`${C}/${S}.jsonl`]: conv(['user', 'q1'], ['assistant', 'a1']) }, HOME);
    const summary = await runAuditMigration(fs, () => {});

    const expected = [{ id: S, outcome: 'migrate', inserts: { exact: 1, unpaired: 0 } }];
    const actual = summary.plan;
    expect(actual).toEqual(expected);
  });

  it('reports a skipped file in the plan by its outcome', async () => {
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: `${asst('a1')}\n` }, HOME);
    const summary = await runAuditMigration(fs, () => {});

    const expected = [{ id: S, outcome: 'skipped' }];
    const actual = summary.plan;
    expect(actual).toEqual(expected);
  });
});

// Object fixtures for the exported `align` (it takes parsed lines/rows, not JSON).
const aLine = (text: string, extra: Record<string, unknown> = {}) => ({ role: 'assistant', timestamp: 't', content: [{ type: 'text', text }], ...extra });
const uRow = (text: string) => ({ role: 'user' as const, content: [{ type: 'text', text }] });
const aRow = (text: string) => ({ role: 'assistant' as const, content: [{ type: 'text', text }] });
// A deterministic id source: `id-1`, `id-2`, … in call order, so a stamped line's
// ids are exact rather than random. align mints per matched turn in the order
// queryId (when the query opens), turnId, then the user message's id.
const counter = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('align — id stamping', () => {
  it('inserts the reconstructed user line carrying the generated ids', () => {
    const auditLines = [aLine('a1', { id: 'msg_01' })];
    const convRows = [uRow('q1'), aRow('a1')];

    const expected = { role: 'user', id: 'id-3', turnId: 'id-2', queryId: 'id-1', timestamp: 't', content: [{ type: 'text', text: 'q1' }] };
    const actual = align(auditLines, convRows, counter()).output[0];
    expect(actual).toEqual(expected);
  });

  it('stamps turnId/queryId onto the assistant line, its content and id untouched', () => {
    const auditLines = [aLine('a1', { id: 'msg_01' })];
    const convRows = [uRow('q1'), aRow('a1')];

    const expected = { role: 'assistant', timestamp: 't', content: [{ type: 'text', text: 'a1' }], id: 'msg_01', turnId: 'id-2', queryId: 'id-1' };
    const actual = align(auditLines, convRows, counter()).output[1];
    expect(actual).toEqual(expected);
  });

  it('gives the inserted user line and its assistant the same turnId', () => {
    const auditLines = [aLine('a1', { id: 'msg_01' })];
    const convRows = [uRow('q1'), aRow('a1')];
    const { output } = align(auditLines, convRows);

    const expected = output[1].turnId;
    const actual = output[0].turnId;
    expect(actual).toBe(expected);
  });

  it('leaves an already-v2 line untouched while stamping the appended v1 tail', () => {
    // A partially-migrated file: a v2 pair (turnId 'T1') then a fresh v1 tail line.
    const auditLines = [{ role: 'user', id: 'u1', turnId: 'T1', queryId: 'Q1', timestamp: 't', content: [{ type: 'text', text: 'q1' }] }, aLine('a1', { id: 'msg_01', turnId: 'T1', queryId: 'Q1' }), aLine('a2', { id: 'msg_02', timestamp: 't2' })];
    const convRows = [uRow('q1'), aRow('a1'), uRow('q2'), aRow('a2')];

    const expected = 'T1';
    const actual = align(auditLines, convRows, counter()).output[1].turnId;
    expect(actual).toBe(expected);
  });

  it('gives two turns of one query distinct turnIds', () => {
    // One query spanning two turns: a text send, then its tool_result continuation.
    // Both share the queryId (proven in the query-grouping block); each turn must
    // still get its OWN turnId, one per user+assistant pair.
    const toolResult = { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'r' }] };
    const auditLines = [aLine('a1', { id: 'msg_01' }), aLine('a2', { id: 'msg_02' })];
    const convRows = [uRow('q1'), aRow('a1'), toolResult, aRow('a2')];
    const { output } = align(auditLines, convRows);

    const firstTurn = output[1].turnId;
    const actual = output[3].turnId;
    expect(actual).not.toBe(firstTurn);
  });

  it('does not insert a user line when the matched assistant has no preceding user row', () => {
    // A conversation that opens on an assistant row (a === 0): convRows[a - 1] is
    // undefined, so the `?? []` fallback reconstructs an EMPTY user delta and would
    // insert a phantom empty user line into the permanent audit. There is no user
    // message to recover here — the assistant line is left as-is, no user line added.
    const auditLines = [aLine('a1', { id: 'msg_01' })];
    const convRows = [aRow('a1')];

    const expected = ['assistant'];
    const actual = align(auditLines, convRows, counter()).output.map((l) => l.role);
    expect(actual).toEqual(expected);
  });
});

describe('align — query grouping', () => {
  it('opens a new query for a text-first user message', () => {
    const auditLines = [aLine('a1', { id: 'msg_01' }), aLine('a2', { id: 'msg_02' })];
    const convRows = [uRow('q1'), aRow('a1'), uRow('q2'), aRow('a2')];
    const { output } = align(auditLines, convRows);

    const firstQuery = output[0].queryId;
    const actual = output[2].queryId;
    expect(actual).not.toBe(firstQuery);
  });

  it('continues the current query for a tool_result-first user message', () => {
    const toolResult = { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'r' }] };
    const auditLines = [aLine('a1', { id: 'msg_01' }), aLine('a2', { id: 'msg_02' })];
    const convRows = [uRow('q1'), aRow('a1'), toolResult, aRow('a2')];
    const { output } = align(auditLines, convRows);

    const expected = output[0].queryId;
    const actual = output[2].queryId;
    expect(actual).toBe(expected);
  });

  it('rejoins the open query of a v2 head for a tool_result tail', () => {
    // A partially-migrated file: a v2 pair (queryId 'Q1') then a fresh v1 tail whose
    // delta is a tool_result — a continuation, so it must REJOIN 'Q1', not open a new
    // query. (The existing tail test uses a text-first tail, which opens a new one.)
    const toolResult = { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'r' }] };
    const auditLines = [{ role: 'user', id: 'u1', turnId: 'T1', queryId: 'Q1', timestamp: 't', content: [{ type: 'text', text: 'q1' }] }, aLine('a1', { id: 'msg_01', turnId: 'T1', queryId: 'Q1' }), aLine('a2', { id: 'msg_02', timestamp: 't2' })];
    const convRows = [uRow('q1'), aRow('a1'), toolResult, aRow('a2')];

    const expected = 'Q1';
    const actual = align(auditLines, convRows, counter()).output[3].queryId;
    expect(actual).toBe(expected);
  });
});

describe('runAuditMigration — v2 discriminator', () => {
  it('leaves a fully v2 file untouched', async () => {
    const v2user = JSON.stringify({ role: 'user', id: 'u1', turnId: 'T1', queryId: 'Q1', timestamp: 'ts', content: [{ type: 'text', text: 'q1' }] });
    const v2asst = JSON.stringify({ timestamp: 'ts', role: 'assistant', id: 'msg_01', turnId: 'T1', queryId: 'Q1', content: [{ type: 'text', text: 'a1' }] });
    const file = `${v2user}\n${v2asst}\n`;
    const fs = new MemoryFileSystem({ [`${A}/${S}.jsonl`]: file }, HOME);
    const summary = await runAuditMigration(fs, () => {}, true);

    const expected = { migrated: 0, unchanged: 1, file };
    const actual = { migrated: summary.migrated, unchanged: summary.unchanged, file: await fs.readFile(`${A}/${S}.jsonl`) };
    expect(actual).toEqual(expected);
  });
});
