import { randomUUID } from 'node:crypto';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IFileEntry } from '@shellicar/claude-core/fs/types';

export type MigrationSummary = {
  scanned: number; // audit files seen
  migrated: number; // files changed (--apply), or that would change (dry run)
  unchanged: number; // already-converged files (no-op)
  skipped: number; // conversation file absent or old-format
  failed: number; // safety self-check failed; file left untouched
  raced: number; // audit file grew between the two stats (a concurrent append) — skipped; a convergent re-run heals it
  corrupt: string[]; // ids skipped because a JSON line failed to parse — left untouched, named for the operator
  pairing: { exact: number; inferred: number; unpaired: number }; // user lines inserted, by confidence
  plan: SessionPlan[]; // per-file outcome — what a real run would do (dry) or did (--apply)
};

type AuditLine = { role?: string; timestamp?: string; content?: unknown; [k: string]: unknown };
type ConvRow = { role: 'user' | 'assistant'; content: unknown };
export type PairCounts = { exact: number; inferred: number; unpaired: number };

// Per-file outcome for the dry-run report: what a real run would do to each
// session (or, under --apply, what it did).
export type SessionOutcome = 'migrate' | 'unchanged' | 'skipped' | 'raced' | 'failed' | 'corrupt';
export type SessionPlan = {
  id: string;
  outcome: SessionOutcome;
  inserts?: PairCounts; // for 'migrate': the user lines to insert, by confidence
};

/** Per-LINE test: an assistant line is already paired iff the line before it is a
 *  user line. True when any assistant line still lacks a preceding user line. */
function needsWork(lines: AuditLine[]): boolean {
  return lines.some((line, i) => line.role !== 'user' && lines[i - 1]?.role !== 'user');
}

/** Parse the bare {role, content} transcript. Tolerates a newer `_identity`
 *  sidecar (extra keys ignored). Returns null for the genuinely old,
 *  differently-shaped files (§1.3), which the caller skips. */
function parseConversation(raw: string): ConvRow[] | null {
  const rows: ConvRow[] = [];
  for (const line of raw.split('\n').filter((l) => l.length > 0)) {
    const row = JSON.parse(line) as { role?: unknown; content?: unknown };
    if ((row.role === 'user' || row.role === 'assistant') && row.content !== undefined) {
      rows.push({ role: row.role, content: row.content });
    } else {
      return null;
    }
  }
  return rows;
}

/** The alignment match key (poc-design §2.3): a message's `tool_use` ids where it
 *  has any, its text-block content otherwise. A pure tool_use turn carries no
 *  text, so keying on text alone compares '' === '' and mispairs it — and an
 *  interrupted no-text turn would falsely consume a conversation row and shift
 *  every insert after it. The `tool_use` id is byte-identical across audit and
 *  conversation (audit adds a `caller` field but leaves the id untouched), so
 *  pure tool_use turns match exactly by id. An empty key (no text, no tool_use)
 *  is returned as '' and never matches (guarded at the call site in `align`). */
function keyOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const toolIds = content
      .filter((b): b is { type: 'tool_use'; id: string } => (b as { type?: unknown }).type === 'tool_use' && typeof (b as { id?: unknown }).id === 'string')
      .map((b) => b.id);
    if (toolIds.length > 0) {
      return toolIds.join(',');
    }
    return content
      .filter((b): b is { type: 'text'; text: string } => (b as { type?: unknown }).type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

/** Walk the audit lines in order, keeping the conversation cursor `ci` in step.
 *  For each audit assistant line — already paired or not — consume its matching
 *  conversation assistant row so later lines stay aligned; insert a user line
 *  only for the ones not already paired. Audit ⊇ conversation, so an audit line
 *  with no counterpart is an interrupted turn: left as-is, ci not advanced.
 *  (Advancing ci for already-paired lines too is what keeps a convergence re-run
 *  correct: a freshly appended tail line still aligns to the right conversation row.) */
export function align(auditLines: AuditLine[], convRows: ConvRow[]): { output: AuditLine[]; counts: PairCounts } {
  const output: AuditLine[] = [];
  const counts: PairCounts = { exact: 0, inferred: 0, unpaired: 0 };
  let ci = 0;
  for (const line of auditLines) {
    if (line.role === 'user') {
      output.push(line); // an already-inserted delta line — keep; ci untouched
      continue;
    }
    const alreadyPaired = output.at(-1)?.role === 'user';
    let a = ci;
    while (a < convRows.length && convRows[a].role !== 'assistant') {
      a++;
    }
    const key = keyOf(line.content);
    // An empty key (no text, no tool_use) never matches, so a no-text turn is
    // never mispaired against another empty-text row (poc-design §2.3).
    if (key !== '' && a < convRows.length && key === keyOf(convRows[a].content)) {
      if (!alreadyPaired) {
        // the delta is the user row immediately before the matched assistant
        output.push({ role: 'user', timestamp: line.timestamp, content: convRows[a - 1]?.content ?? [], pairing: 'exact' });
        counts.exact++;
      }
      output.push(line);
      ci = a + 1; // consume the matched conversation assistant either way
    } else {
      // no counterpart → interrupted turn (audit ⊇ conversation). Leave as-is;
      // do not advance ci. With the id-first key a pure tool_use turn matches by
      // id, so only a genuine interruption or an empty-key turn lands here;
      // counted `unpaired`.
      output.push(line);
      if (!alreadyPaired) {
        counts.unpaired++;
      }
    }
  }
  return { output, counts };
}

/** Next backup index for this id: 1 + the highest existing `<id>.bak.<n>`, so a
 *  rerun never clobbers a prior backup. The bak dir may not exist on the first
 *  run — readdir throws ENOENT there, meaning "no backups yet". */
async function nextBackupIndex(fs: IFileSystem, bakDir: string, id: string): Promise<number> {
  let highest = 0;
  try {
    const re = new RegExp(`^${id}\\.bak\\.(\\d+)$`);
    for (const entry of await fs.readdir(bakDir)) {
      const m = entry.name.match(re);
      if (m) {
        highest = Math.max(highest, Number(m[1]));
      }
    }
  } catch {
    // bak/ does not exist yet — this is the first backup of the run.
  }
  return highest + 1;
}

/** Guard, backup, write-alongside-and-swap. Takes the aligned `output` as a
 *  parameter so the safety self-check can be exercised with a constructed output
 *  that drops an assistant line (§B.7). */
export async function commit(
  fs: IFileSystem,
  auditDir: string,
  auditPath: string,
  auditRaw: string,
  auditLines: AuditLine[],
  output: AuditLine[],
  counts: PairCounts,
  id: string,
  beforeSize: number,
  apply: boolean,
  summary: MigrationSummary,
): Promise<void> {
  // Load-bearing guard: the migration only INSERTS user lines, so the assistant-line
  // count must be identical. If it is not, the alignment dropped or duplicated a
  // response — do NOT swap. (This is the only phase that rewrites the record.)
  const assistantCount = (lines: AuditLine[]) => lines.filter((l) => l.role !== 'user').length;
  if (assistantCount(auditLines) !== assistantCount(output)) {
    summary.failed++;
    summary.plan.push({ id, outcome: 'failed' });
    return;
  }

  const newRaw = `${output.map((l) => JSON.stringify(l)).join('\n')}\n`;
  if (newRaw === auditRaw) {
    summary.unchanged++; // no-op (e.g. only unpaired lines remained)
    summary.plan.push({ id, outcome: 'unchanged' });
    return;
  }

  // Concurrent-append guard: re-stat right before the swap. The run's guarantee
  // is that no live CLI is writing, but the script cannot enforce that, so it
  // defends itself. Old CLIs only APPEND, so any write we missed strictly grows
  // the file; a size change since the pre-read stat means a turn landed after our
  // snapshot. Do not swap — skip and let the next convergent run heal it. (Still
  // check-then-act: an append in the sliver between this stat and the rename is
  // not closed by any migration-side code — the no-live-CLI precondition is the
  // real guard; this catches a CLI that was missed, at near-zero cost.)
  if ((await fs.stat(auditPath)).size !== beforeSize) {
    summary.raced++;
    summary.plan.push({ id, outcome: 'raced' });
    return;
  }

  // Writes happen only under --apply. A bare (dry) run has already computed
  // everything a real run would — the alignment, the safety guard, the race
  // check — and now records it in the report while leaving every file untouched:
  // no backup, no tmp file, no rename. This makes the safe behaviour the default.
  if (apply) {
    // Backup BEFORE any modification — a fresh numbered backup per run.
    const bakDir = `${auditDir}/bak`;
    await fs.writeFile(`${bakDir}/${id}.bak.${await nextBackupIndex(fs, bakDir, id)}`, auditRaw);

    // Write-alongside-and-swap: rename is atomic on one filesystem, so a concurrent
    // reader sees the old or the complete new file, never a half-written one (the
    // pattern ConversationSession.saveConversation uses).
    const tmp = `${auditPath}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, newRaw);
    await fs.rename(tmp, auditPath);
  }

  summary.migrated++;
  summary.pairing.exact += counts.exact;
  summary.pairing.inferred += counts.inferred;
  summary.pairing.unpaired += counts.unpaired;
  summary.plan.push({ id, outcome: 'migrate', inserts: { ...counts } });
}

async function migrateSession(fs: IFileSystem, auditDir: string, convDir: string, id: string, apply: boolean, summary: MigrationSummary): Promise<void> {
  const auditPath = `${auditDir}/${id}.jsonl`;
  // stat BEFORE the read: the concurrent-append guard in `commit` compares this
  // against a second stat taken right before the swap. Taken after the read, it
  // could bake an already-landed append into the baseline and rename it away.
  const beforeSize = (await fs.stat(auditPath)).size;
  const auditRaw = await fs.readFile(auditPath);
  const auditLines = auditRaw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as AuditLine);
  if (!needsWork(auditLines)) {
    summary.unchanged++; // every assistant line already paired — no conversation read, no write
    summary.plan.push({ id, outcome: 'unchanged' });
    return;
  }

  const convPath = `${convDir}/${id}.jsonl`;
  if (!(await fs.exists(convPath))) {
    summary.skipped++; // conversation absent — cannot reconstruct deltas
    summary.plan.push({ id, outcome: 'skipped' });
    return;
  }
  const convRows = parseConversation(await fs.readFile(convPath));
  if (convRows === null) {
    summary.skipped++; // old-format conversation (§1.3), per poc-design §2.3
    summary.plan.push({ id, outcome: 'skipped' });
    return;
  }

  const { output, counts } = align(auditLines, convRows);
  await commit(fs, auditDir, auditPath, auditRaw, auditLines, output, counts, id, beforeSize, apply, summary);
}

/**
 * Standalone, idempotent, convergent backfill: rewrites existing assistant-only
 * audit files into the alternating transcript by INSERTING the missing user
 * lines — never rewriting an assistant line. Reads `conversations/` but never
 * writes it. Backs up each modified file before touching it, and swaps atomically.
 *
 * Dry run by DEFAULT: with `apply` false it performs the full scan and alignment
 * and records what a real run would do in `summary.plan` (per file) while writing
 * nothing — no backup, no tmp file, no rename. Pass `apply` true to write.
 */
export async function runAuditMigration(fs: IFileSystem, log: (msg: string) => void, apply = false): Promise<MigrationSummary> {
  const auditDir = `${fs.homedir()}/.claude/audit`;
  const convDir = `${fs.homedir()}/.claude/conversations`;
  const summary: MigrationSummary = { scanned: 0, migrated: 0, unchanged: 0, skipped: 0, failed: 0, raced: 0, corrupt: [], pairing: { exact: 0, inferred: 0, unpaired: 0 }, plan: [] };

  let entries: IFileEntry[];
  try {
    entries = await fs.readdir(auditDir);
  } catch {
    return summary; // no audit directory yet — nothing to migrate
  }
  for (const entry of entries) {
    // Skip the bak/ subdirectory and any non-<uuid>.jsonl file.
    if (!entry.isFile() || !/^[0-9a-f-]{36}\.jsonl$/.test(entry.name)) {
      continue;
    }
    summary.scanned++;
    const id = entry.name.slice(0, -'.jsonl'.length);
    try {
      await migrateSession(fs, auditDir, convDir, id, apply, summary);
    } catch {
      // A malformed or truncated JSON line in this session's audit or conversation
      // file throws during parse — before any swap, so the file is untouched. Skip
      // it, name it in the summary, and carry on rather than aborting the whole run.
      summary.corrupt.push(id);
      summary.plan.push({ id, outcome: 'corrupt' });
    }
  }

  // Log the pairing-confidence distribution so it can be eyeballed against the
  // known alignment stats (≈1,744/1,929 sessions exact); a large deviation is a
  // signal the alignment misbehaved (§B.5).
  log(`audit migration (${apply ? 'apply' : 'dry run'}): ${JSON.stringify(summary)}`);
  return summary;
}
