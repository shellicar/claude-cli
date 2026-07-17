import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IFileEntry } from '@shellicar/claude-core/fs/types';
import type { IHistoryWriter } from '@shellicar/claude-core/history/interfaces';
import type { HistoryMessage } from '@shellicar/claude-core/history/types';
import { parseAuditLine } from '../src/persistence/historyAuditLine.js';

export type IngestSummary = {
  /** Audit files scanned. */
  files: number;
  /** v2 lines written through to the index (a re-run of an already-indexed line still counts here; the store dedups it). */
  inserted: number;
  /** Lines ignored — v1 (pre-migration) lines with no ids to insert. */
  skipped: number;
  /** Lines skipped because the JSON failed to parse — a truncated or corrupt line, isolated so the rest of the rebuild proceeds. */
  corrupt: number;
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
  const summary: IngestSummary = { files: 0, inserted: 0, skipped: 0, corrupt: 0 };
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
    let corrupt = 0;
    for (const rawLine of raw.split('\n')) {
      if (rawLine.length === 0) {
        continue;
      }
      // Isolate a truncated or corrupt line to itself. This is the disaster-recovery path, most likely run
      // right after a crash, so one unparseable line must skip and let the rest of the rebuild proceed rather
      // than abort every conversation. Unlike the migration (which rewrites the file and so skips a corrupt
      // file whole), the ingest only reads, so it drops the one bad line and indexes the good ones.
      let message: HistoryMessage | null;
      try {
        message = parseAuditLine(rawLine, conversationId);
      } catch {
        corrupt++;
        continue;
      }
      if (message === null) {
        skipped++;
        continue;
      }
      writer.insert(message);
      inserted++;
    }
    summary.inserted += inserted;
    summary.skipped += skipped;
    summary.corrupt += corrupt;
    log(`${entry.name}: ${inserted} inserted, ${skipped} skipped, ${corrupt} corrupt`);
  }
  return summary;
}
