import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IConversation, ISkillGateProvider, type SkillGateResult } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';

/** A `tool_result` block's `content` is the un-transformed `Skill` output verbatim (`{ found,
 *  skill, ... }`) unless the ref-swap transform intervened for an oversized body; either way, an
 *  unparsable or ref-swapped body carries no `found: true` and is correctly treated as not loaded
 *  (fail closed, never fail open). `is_error` alone is not enough to prove success: the `Skill`
 *  tool reports a missing/typo'd skill name as an ordinary, non-error result with `found: false`
 *  (see Skill.ts), so a name that never resolved must not open the gate. */
function skillLoadSucceeded(block: { is_error?: boolean; content?: unknown }): boolean {
  if (block.is_error) {
    return false;
  }
  const content = block.content;
  const text = Array.isArray(content) ? (content.find((b): b is { type: string; text: string } => (b as { type?: string }).type === 'text')?.text ?? null) : typeof content === 'string' ? content : null;
  if (text === null) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return (parsed as { found?: unknown } | null)?.found === true;
  } catch {
    return false;
  }
}

/** Every `Skill` tool_use whose input names a skill, keyed by that call's tool_use id, paired
 *  with whether a same-named tool_result later reported `found: true` — built fresh per check
 *  from `conversation.items`, never cached. This is what makes a restart free: `items` already
 *  holds the full replayed history by the time `setHistory` returns, live pushes append to the
 *  same array, and this function does not care which produced any given entry. `items` also holds
 *  every message forever regardless of compaction (see `Conversation`), so a skill loaded before a
 *  compaction still counts even though the compacted request sent to the API no longer carries it. */
function loadedSkillNames(conversation: IConversation): Set<string> {
  const attempted = new Map<string, string>();
  const loaded = new Set<string>();
  for (const { msg } of conversation.items) {
    if (!Array.isArray(msg.content)) {
      continue;
    }
    if (msg.role === 'assistant') {
      for (const block of msg.content) {
        if (block.type !== 'tool_use' || block.name !== 'Skill') {
          continue;
        }
        const skill = (block.input as { skill?: unknown }).skill;
        if (typeof skill === 'string') {
          attempted.set(block.id, skill);
        }
      }
    } else if (msg.role === 'user') {
      for (const block of msg.content) {
        if (block.type !== 'tool_result') {
          continue;
        }
        const skill = attempted.get(block.tool_use_id);
        if (skill !== undefined && skillLoadSucceeded(block)) {
          loaded.add(skill);
        }
      }
    }
  }
  return loaded;
}

/** Config-driven, conversation-aware `ISkillGateProvider`: certain tools (named in
 *  `config.requiredSkills`) may only be called once every skill listed for them has been
 *  successfully loaded via the `Skill` tool earlier in this conversation. Both halves are read
 *  fresh on every `check` call — the required-skills map off the live `ConfigLoader` (so an
 *  edit takes effect on the very next tool_use, matching `ConfigDisabledToolsProvider`'s
 *  live-read contract) and which skills have loaded off the live `Conversation` (so a `Skill`
 *  load earlier in the same turn already counts). */
export class SkillGateProvider extends ISkillGateProvider {
  @dependsOn(ConfigLoader) public configLoader!: ConfigLoader<any>;
  @dependsOn(IConversation) public conversation!: IConversation;

  public check(toolName: string): SkillGateResult {
    // The Skill tool can never be required to unlock itself: a requiredSkills entry naming
    // 'Skill' would deadlock it permanently (nothing can call Skill to satisfy the requirement,
    // since the call to do so is itself blocked). Configuring it that way is a config mistake,
    // not a real requirement, so it is ignored rather than honoured.
    if (toolName === 'Skill') {
      return { allowed: true };
    }
    const required = this.configLoader.config.requiredSkills[toolName] as string[] | undefined;
    if (required === undefined || required.length === 0) {
      return { allowed: true };
    }
    const loaded = loadedSkillNames(this.conversation);
    const missing = required.filter((skill: string) => !loaded.has(skill));
    return missing.length === 0 ? { allowed: true } : { allowed: false, missing };
  }
}
