import { type RulesSectionState, resolveRulesSection } from './rulesSection';

export type RulesConfigNotice = { kind: 'invalid'; error: string } | { kind: 'recovered' } | { kind: 'changed' };

const emptyState: RulesSectionState = { rules: {}, blockedCommands: [] };

/** Owns the live `{ tools.rules, tools.blockedCommands }` state across config reloads, with two
 *  different failure policies over the same validation (`resolveRulesSection`):
 *
 *  - construction (the initial config at boot) fails fast: an invalid section throws, naming
 *    what was wrong, so the CLI refuses to start on a broken config rather than silently
 *    running with defaults.
 *  - `update()` (a live reload) never throws: one bad edit to a config file must not be able to
 *    take down anything depending on this gate staying alive. It reports what happened via its
 *    return value \u2014 `null` (no change worth announcing), `{ kind: 'changed' }`, `{ kind: 'invalid', error }`
 *    (state pinned to the last known-good value), or `{ kind: 'recovered' }` (a fix landed after
 *    a prior invalid update) \u2014 and showing that to the user is the caller's job, not this class's. */
export class RulesConfigGate {
  private current: RulesSectionState;
  private degraded = false;
  private lastError: string | null = null;

  public constructor(raw: unknown) {
    const result = resolveRulesSection(raw, emptyState);
    if (!result.ok) {
      throw new Error(`Invalid tools.rules/tools.blockedCommands: ${result.error}`);
    }
    this.current = result.state;
  }

  public get state(): RulesSectionState {
    return this.current;
  }

  public update(raw: unknown): RulesConfigNotice | null {
    const result = resolveRulesSection(raw, this.current);

    if (!result.ok) {
      const isRepeat = this.degraded && this.lastError === result.error;
      this.degraded = true;
      this.lastError = result.error;
      return isRepeat ? null : { kind: 'invalid', error: result.error };
    }

    const wasDegraded = this.degraded;
    this.degraded = false;
    this.lastError = null;

    if (!result.changed) {
      return wasDegraded ? { kind: 'recovered' } : null;
    }

    this.current = result.state;
    return wasDegraded ? { kind: 'recovered' } : { kind: 'changed' };
  }
}
