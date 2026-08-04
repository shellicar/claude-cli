import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { type CacheTtl, calculateCost, calculateCostSplit, getContextWindow, reconstructCacheSplit, type ThinkingEffort } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { auditPathFor } from './conversations/auditPath.js';
import type { CacheParameters } from './model/ModelSettings.js';
import type { StatusTotals } from './model/StatusState.js';

/** An audit line: the stored BetaMessage plus the fields the audit now adds —
 * the derived `costUsd` and the normalized per-duration breakdown. Both are
 * absent on lines written before this change. */
type AuditLine = BetaMessage & {
  costUsd?: number;
  cacheCreation?: { fiveMinute: number; oneHour: number };
  request?: { thinking: boolean; effort: ThinkingEffort | null };
};

/** Everything one pass over a conversation's audit yields: the running totals the status bar
 *  shows, and what its last request was sent with. Both come off the same read because the cache
 *  warning needs the prefix size and the parameters together, and two reads could disagree. */
export type AuditDerivation = {
  totals: StatusTotals;
  /** What the cached prefix was written under, or null when no line carries it: nothing has been
   *  sent yet, or the lines predate the parameters being recorded. */
  cached: CacheParameters | null;
  /** The model of the last assistant line, or null when the conversation has sent nothing. The API
   *  reports the model on every line however old, so this is known even where `cached` is not, and
   *  a non-null value is also what says the conversation has a cached prefix at all. */
  lastModel: string | null;
};

/**
 * A usable audit line: an assistant turn carrying `usage`. The audit also holds
 * non-assistant lines (user-role messages, added by a separate feature) that
 * have no usage/cost, so the token/cost derivation keeps only these. Role is an
 * allowlist (a missing role is a legacy assistant line) and `usage` must be
 * present, so a bad line is skipped rather than throwing a TypeError mid-total.
 */
const isUsableLine = (line: unknown): line is AuditLine => {
  if (typeof line !== 'object' || line === null) {
    return false;
  }
  const role = (line as { role?: string }).role ?? 'assistant';
  return role === 'assistant' && 'usage' in line;
};

const EMPTY: StatusTotals = {
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  lastContextUsed: 0,
  contextWindow: 0,
};

/**
 * Derives the status-line totals for a conversation id from its audit file.
 * This is the source of the figures the status line reads: they reflect the
 * current conversation rather than accumulating over the process lifetime.
 */
export class AuditStats {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;

  /**
   * Derive the status totals for a conversation id from its audit file. Returns
   * the zero snapshot when the id has no audit data, so a fresh id reads as
   * empty. `cacheTtl` is the configured TTL, consulted only for the last-resort
   * legacy fallback in #lineCost.
   */
  public async derive(id: string, cacheTtl: CacheTtl): Promise<AuditDerivation> {
    const path = auditPathFor(this.fs, id);
    if (!(await this.fs.exists(path))) {
      return { totals: { ...EMPTY }, cached: null, lastModel: null };
    }
    const raw = await this.fs.readFile(path);
    // The audit file is now an alternating user/assistant transcript; only the
    // assistant lines carry usage/cost. User transcript lines (role: 'user', no
    // usage) are skipped so the totals and the last-line context read stay correct.
    const lines = raw
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l))
      .filter(isUsableLine);
    if (lines.length === 0) {
      return { totals: { ...EMPTY }, cached: null, lastModel: null };
    }
    const totals: StatusTotals = { ...EMPTY };
    for (const line of lines) {
      totals.inputTokens += line.usage.input_tokens;
      totals.cacheCreationTokens += line.usage.cache_creation_input_tokens ?? 0;
      totals.cacheReadTokens += line.usage.cache_read_input_tokens ?? 0;
      totals.outputTokens += line.usage.output_tokens;
      totals.costUsd += this.#lineCost(line, cacheTtl);
    }
    const last = lines[lines.length - 1];
    totals.lastContextUsed = last.usage.input_tokens + (last.usage.cache_creation_input_tokens ?? 0) + (last.usage.cache_read_input_tokens ?? 0);
    totals.contextWindow = getContextWindow(last.model);
    // The model comes off the line's own `model` field, which the API reported, rather than from
    // anything the CLI wrote about the request it thought it was making.
    const cached = last.request != null ? { model: last.model, thinking: last.request.thinking, effort: last.request.effort } : null;
    return { totals, cached, lastModel: last.model };
  }

  /**
   * Cost for one audit line. Prefer the stored `costUsd` (the correct value
   * written at turn time). Failing that, price a per-duration breakdown at each
   * duration's own rate — the stored normalized breakdown, or the raw ephemeral
   * `usage.cache_creation` split. Only when a line has neither — a legacy line
   * carrying just the flat cache-creation total — fall back to pricing that flat
   * total against the configured TTL as a single assumed duration. That last
   * branch is the only place a TTL is assumed.
   */
  #lineCost(line: AuditLine, cacheTtl: CacheTtl): number {
    if (line.costUsd != null) {
      return line.costUsd;
    }
    const split = line.cacheCreation ?? (line.usage.cache_creation != null ? reconstructCacheSplit(line.usage) : null);
    if (split != null) {
      return calculateCostSplit(
        {
          inputTokens: line.usage.input_tokens,
          cacheCreation5mTokens: split.fiveMinute,
          cacheCreation1hTokens: split.oneHour,
          cacheReadTokens: line.usage.cache_read_input_tokens ?? 0,
          outputTokens: line.usage.output_tokens,
        },
        line.model,
      );
    }
    return calculateCost(
      {
        inputTokens: line.usage.input_tokens,
        cacheCreationTokens: line.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: line.usage.cache_read_input_tokens ?? 0,
        outputTokens: line.usage.output_tokens,
      },
      line.model,
      cacheTtl,
    );
  }
}
