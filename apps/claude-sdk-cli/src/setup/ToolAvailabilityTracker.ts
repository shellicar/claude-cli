import type { Anthropic } from '@anthropic-ai/sdk';

const ENABLED_HEADER = 'Enabled tools:';
const DISABLED_HEADER = 'Disabled tools:';

function isSystemReminderText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('<system-reminder>') && trimmed.endsWith('</system-reminder>');
}

/** Parses one previously-emitted reminder's delta back into name lists, or null when `text` isn't
 *  one of ours. Tool names never contain '.' or ',', so splitting on the header/period/comma
 *  boundaries is unambiguous. */
function parseDelta(text: string): { enabled: string[]; disabled: string[] } | null {
  if (!isSystemReminderText(text)) {
    return null;
  }
  const inner = text.trim().slice('<system-reminder>'.length, -'</system-reminder>'.length).trim();
  if (!inner.startsWith(ENABLED_HEADER) && !inner.startsWith(DISABLED_HEADER)) {
    return null;
  }
  const enabledMatch = inner.match(/Enabled tools: ([^.]+)\./);
  const disabledMatch = inner.match(/Disabled tools: ([^.]+)\./);
  const splitNames = (s: string): string[] =>
    s
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 0);
  return {
    enabled: enabledMatch ? splitNames(enabledMatch[1] ?? '') : [],
    disabled: disabledMatch ? splitNames(disabledMatch[1] ?? '') : [],
  };
}

function formatDelta(enabled: readonly string[], disabled: readonly string[]): string {
  const parts: string[] = [];
  if (enabled.length > 0) {
    parts.push(`${ENABLED_HEADER} ${[...enabled].sort().join(', ')}.`);
  }
  if (disabled.length > 0) {
    parts.push(`${DISABLED_HEADER} ${[...disabled].sort().join(', ')}.`);
  }
  return parts.join(' ');
}

/**
 * Tells the model which tools it currently has, as a delta rather than a repeated full list — a
 * single tool flipping never re-announces the other 99.
 *
 * On the first call this process makes, the baseline is reconstructed by replaying every reminder
 * this tracker ever emitted, in order, out of the persisted conversation history — so a restart
 * loses nothing without the tracker needing its own persisted state. Finding nothing (fresh
 * conversation, or history compacted past every prior reminder) reconstructs an empty baseline,
 * which is not a special case: diffing the live set against empty naturally produces a full
 * "Enabled tools:" opener with nothing in "Disabled tools:".
 *
 * Every call after the first behaves like `CwdTracker`/`SkillCatalogueTracker`: an in-memory diff
 * against the previous call's result, updated (and only emitted) when something actually changed;
 * `messages` is ignored once seeded. Call this once per turn, with the live set as computed at the
 * point a message is actually about to be built and sent — never speculatively, and never advanced
 * by an attempt that didn't land — so a cancel-and-resend recomputes the same diff against the same
 * unmoved baseline rather than skipping or doubling it.
 */
export class ToolAvailabilityTracker {
  #known: Set<string> | null = null;

  #seedFromHistory(messages: readonly Anthropic.Beta.Messages.BetaMessageParam[]): Set<string> {
    const known = new Set<string>();
    for (const msg of messages) {
      if (msg.role !== 'user' || !Array.isArray(msg.content)) {
        continue;
      }
      for (const block of msg.content) {
        if (block.type !== 'text') {
          continue;
        }
        const delta = parseDelta(block.text);
        if (delta == null) {
          continue;
        }
        for (const name of delta.enabled) {
          known.add(name);
        }
        for (const name of delta.disabled) {
          known.delete(name);
        }
      }
    }
    return known;
  }

  /** Returns the delta reminder text for this query, or null when nothing changed. On the first
   *  call this process makes, the baseline is reconstructed by replaying `messages` (see class
   *  doc); every call after that diffs against the in-memory result of the previous call, and
   *  `messages` is ignored. Never advances state for a message that hasn't actually been sent —
   *  call this once, at the point a query is actually being built, not speculatively. */
  public scanForDelta(messages: readonly Anthropic.Beta.Messages.BetaMessageParam[], liveEnabled: ReadonlySet<string>): string | null {
    const previous = this.#known ?? this.#seedFromHistory(messages);
    const enabled = [...liveEnabled].filter((name) => !previous.has(name));
    const disabled = [...previous].filter((name) => !liveEnabled.has(name));
    this.#known = new Set(liveEnabled);
    if (enabled.length === 0 && disabled.length === 0) {
      return null;
    }
    return formatDelta(enabled, disabled);
  }
}
