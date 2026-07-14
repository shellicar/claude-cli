import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IFileEntry } from '@shellicar/claude-core/fs/types';
import type { IHistoryWriter } from '@shellicar/claude-core/history/interfaces';
import { parseAuditLine } from '../src/persistence/historyAuditLine.js';

export type IngestSummary = {
  /** Audit files scanned. */
  files: number;
  /** v2 lines written through to the index (a re-run of an already-indexed line still counts here; the store dedups it). */
  inserted: number;
  /** Lines ignored — v1 (pre-migration) lines with no ids to insert. */
  skipped: number;
};

// Matches the audit's per-conversation files (`<uuid>.jsonl`), skipping the bak/ subdirectory and anything else.
const AUDIT_FILE = /^[0-9a-f-]{36}\.jsonl$/;

/**
 * Rebuild the index from the audit: a flat loop over every audit file, writing each v2 line through the store's
 * write interface — the same seam the CLI uses — and dropping duplicates on the message id. v1 lines are ignored
 * (the migration converts them first). Idempotent: a second run inserts nothing new.
 */
export async function ingestHistory(fs: IFileSystem, writer: IHistoryWriter, log: (line: string) => void): Promise<IngestSummary> {
  const auditDir = `${fs.homedir()}/.claude/audit`;
  const summary: IngestSummary = { files: 0, inserted: 0, skipped: 0 };
  // readdir, don't probe with exists: a missing audit dir surfaces as ENOENT (the migration reads it the same way).
  let entries: IFileEntry[];
  try {
    entries = await fs.readdir(auditDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      log(`no audit directory at ${auditDir}`);
      return summary;
    }
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !AUDIT_FILE.test(entry.name)) {
      continue;
    }
    summary.files++;
    // The conversation is the file's identity: `<conversationId>.jsonl` (write-model §5). Stamp it onto every
    // message from this file — the line itself carries no session id.
    const conversationId = entry.name.slice(0, -'.jsonl'.length);
    const raw = await fs.readFile(`${auditDir}/${entry.name}`);
    let inserted = 0;
    let skipped = 0;
    for (const rawLine of raw.split('\n')) {
      if (rawLine.length === 0) {
        continue;
      }
      const message = parseAuditLine(rawLine, conversationId);
      if (message === null) {
        skipped++;
        continue;
      }
      writer.insert(message);
      inserted++;
    }
    summary.inserted += inserted;
    summary.skipped += skipped;
    log(`${entry.name}: ${inserted} inserted, ${skipped} skipped`);
  }
  return summary;
}
