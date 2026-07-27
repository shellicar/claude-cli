/**
 * Gates a disabled-tools notice so it appears only when a tool's disabled/enabled state actually
 * flips, not on every config reload. Diffs by tool name only, not by tool definition identity —
 * the live `disabledTools` set (see `IDisabledToolsProvider`) is exactly a set of names, and that's
 * all this needs to compare.
 *
 * The baseline seeds from the already-computed disabled set at construction, so startup prints
 * nothing and the first reload prints only the tools that actually changed since then.
 */
export class DisabledToolsNoticeGate {
  #lastDisabled: ReadonlySet<string>;

  public constructor(initialDisabled: ReadonlySet<string>) {
    this.#lastDisabled = new Set(initialDisabled);
  }

  /**
   * Given the next disabled-tools set, return a notice listing every tool that flipped since the
   * last call (newly enabled, newly disabled), or `null` when nothing changed.
   */
  public update(disabled: ReadonlySet<string>): string | null {
    const enabled = [...this.#lastDisabled].filter((name) => !disabled.has(name)).sort();
    const nowDisabled = [...disabled].filter((name) => !this.#lastDisabled.has(name)).sort();
    this.#lastDisabled = new Set(disabled);

    if (enabled.length === 0 && nowDisabled.length === 0) {
      return null;
    }

    const lines = [...enabled.map((name) => `\u{1f513} ${name} enabled`), ...nowDisabled.map((name) => `\u{1f512} ${name} disabled`)];
    return lines.join('\n');
  }
}
