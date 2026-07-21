import type { BlockedCommand } from '../ExecV3/ExecV3';
import type { RuleOverrideMap } from './ruleConfig';

/** The live rules/blockedCommands contract ExecV3 resolves so it can build its rule set fresh on
 *  every call, without importing the consumer's concrete config source. Read fresh, not pushed:
 *  the consumer's implementation reads its own live state (e.g. a config-watching gate) on each
 *  access, so a config reload is reflected immediately without ExecV3 needing to be notified \u2014
 *  the same shape as `IDisabledToolsProvider`. */
export abstract class IRulesConfigProvider {
  public abstract get rules(): RuleOverrideMap;
  public abstract get blockedCommands(): BlockedCommand[];
}

/** A non-live `IRulesConfigProvider` over fixed values \u2014 for tests and any caller that has no
 *  config to watch. `createExecV3` defaults to an empty one of these, so nothing is blocked
 *  beyond the built-in defaults unless a real provider is supplied. */
export class StaticRulesConfigProvider extends IRulesConfigProvider {
  public constructor(
    private readonly _rules: RuleOverrideMap = {},
    private readonly _blockedCommands: BlockedCommand[] = [],
  ) {
    super();
  }

  public get rules(): RuleOverrideMap {
    return this._rules;
  }

  public get blockedCommands(): BlockedCommand[] {
    return this._blockedCommands;
  }
}
