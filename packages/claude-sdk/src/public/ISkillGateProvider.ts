/**
 * The live skill-gate contract `ToolRegistry` consults before resolving a `tool_use`, so it
 * can require certain tools to be preceded by a named `Skill` load without importing the
 * consumer's concrete config or conversation-history source.
 *
 * Read fresh on every `resolve` call, never cached: both halves of the answer — the
 * required-skills mapping (config, hot-reloaded) and which skills have already loaded
 * (conversation history, which grows between calls) — can change between one tool_use and
 * the next, exactly like `IDisabledToolsProvider`.
 */
export type SkillGateResult = { allowed: true } | { allowed: false; missing: readonly string[] };

export abstract class ISkillGateProvider {
  public abstract check(toolName: string): SkillGateResult;
}
