import { randomUUID } from 'node:crypto';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IFileEntry } from '@shellicar/claude-core/fs/types';

export type MigrationSummary = {
  scanned: number; // audit files seen
  migrated: number; // files changed this run (user lines inserted)
  unchanged: number; // already-converged files (no-op)
  skipped: number; // conversation file absent or old-format
  failed: number; // safety self-check failed; file left untouched
  pairing: { exact: number; inferred: number; unpaired: number }; // user lines inserted, by confidence
};

type AuditLine = { role?: string; timestamp?: string; content?: unknown; [k: string]: unknown };
type ConvRow = { role: 'user' | 'assistant'; content: unknown };
type PairCounts = { exact: number; inferred: number; unpaired: number };

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

/** The match key: the concatenated text of a message's text blocks (§1.4). */
function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
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
    if (a < convRows.length && textOf(convRows[a].content) === textOf(line.content)) {
      if (!alreadyPaired) {
        // the delta is the user row immediately before the matched assistant
        output.push({ role: 'user', timestamp: line.timestamp, content: convRows[a - 1]?.content ?? [], pairing: 'exact' });
        counts.exact++;
      }
      output.push(line);
      ci = a + 1; // consume the matched conversation assistant either way
    } else {
      // no counterpart → interrupted turn (audit ⊇ conversation). Leave as-is;
      // do not advance ci. R4: a no-text tie-break could recover some of these as
      // `inferred` — deferred with tests; counted `unpaired` for now.
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
  summary: MigrationSummary,
): Promise<void> {
  // Load-bearing guard: the migration only INSERTS user lines, so the assistant-line
  // count must be identical. If it is not, the alignment dropped or duplicated a
  // response — do NOT swap. (This is the only phase that rewrites the record.)
  const assistantCount = (lines: AuditLine[]) => lines.filter((l) => l.role !== 'user').length;
  if (assistantCount(auditLines) !== assistantCount(output)) {
    summary.failed++;
    return;
  }

  const newRaw = `${output.map((l) => JSON.stringify(l)).join('\n')}\n`;
  if (newRaw === auditRaw) {
    summary.unchanged++; // no-op (e.g. only unpaired lines remained)
    return;
  }

  // Backup BEFORE any modification — a fresh numbered backup per run.
  const bakDir = `${auditDir}/bak`;
  await fs.writeFile(`${bakDir}/${id}.bak.${await nextBackupIndex(fs, bakDir, id)}`, auditRaw);

  // Write-alongside-and-swap: rename is atomic on one filesystem, so a concurrent
  // reader sees the old or the complete new file, never a half-written one (the
  // pattern ConversationSession.saveConversation uses).
  const tmp = `${auditPath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, newRaw);
  await fs.rename(tmp, auditPath);

  summary.migrated++;
  summary.pairing.exact += counts.exact;
  summary.pairing.inferred += counts.inferred;
  summary.pairing.unpaired += counts.unpaired;
}

async function migrateSession(fs: IFileSystem, auditDir: string, convDir: string, id: string, summary: MigrationSummary): Promise<void> {
  const auditPath = `${auditDir}/${id}.jsonl`;
  const auditRaw = await fs.readFile(auditPath);
  const auditLines = auditRaw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as AuditLine);
  if (!needsWork(auditLines)) {
    summary.unchanged++; // every assistant line already paired — no conversation read, no write
    return;
  }

  const convPath = `${convDir}/${id}.jsonl`;
  if (!(await fs.exists(convPath))) {
    summary.skipped++; // conversation absent — cannot reconstruct deltas
    return;
  }
  const convRows = parseConversation(await fs.readFile(convPath));
  if (convRows === null) {
    summary.skipped++; // old-format conversation (§1.3), per poc-design §2.3
    return;
  }

  const { output, counts } = align(auditLines, convRows);
  await commit(fs, auditDir, auditPath, auditRaw, auditLines, output, counts, id, summary);
}

/**
 * Standalone, idempotent, convergent backfill: rewrites existing assistant-only
 * audit files into the alternating transcript by INSERTING the missing user
 * lines — never rewriting an assistant line. Reads `conversations/` but never
 * writes it. Backs up each modified file before touching it, and swaps atomically.
 */
export async function runAuditMigration(fs: IFileSystem, log: (msg: string) => void): Promise<MigrationSummary> {
  const auditDir = `${fs.homedir()}/.claude/audit`;
  const convDir = `${fs.homedir()}/.claude/conversations`;
  const summary: MigrationSummary = { scanned: 0, migrated: 0, unchanged: 0, skipped: 0, failed: 0, pairing: { exact: 0, inferred: 0, unpaired: 0 } };

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
    await migrateSession(fs, auditDir, convDir, entry.name.slice(0, -'.jsonl'.length), summary);
  }

  // Log the pairing-confidence distribution so it can be eyeballed against the
  // known alignment stats (≈1,744/1,929 sessions exact); a large deviation is a
  // signal the alignment misbehaved (§B.5).
  log(`audit migration: ${JSON.stringify(summary)}`);
  return summary;
}
