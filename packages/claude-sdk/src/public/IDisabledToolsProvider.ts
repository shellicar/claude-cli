/**
 * The live disabled-tool-names contract `ToolRegistry` resolves so it can filter
 * `wireTools` and `resolve` without importing the consumer's concrete config source.
 * Read fresh on every call, not pushed: the consumer's implementation reads its
 * config holder's current value on each access, so a config reload is reflected
 * immediately without the registry needing to be notified.
 */
export abstract class IDisabledToolsProvider {
  public abstract get disabledTools(): ReadonlySet<string>;
}
