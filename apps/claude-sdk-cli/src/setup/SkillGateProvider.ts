import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IConversation, ISkillGateProvider, type SkillGateResult } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';

/** Every `Skill` tool_use whose input names a skill, keyed by that call's tool_use id, paired
 *  with whether a same-named tool_result later reported success — built fresh per check from
 *  `conversation.items`, never cached. This is what makes a restart free: `items` already holds
 *  the full replayed history by the time `setHistory` returns, live pushes append to the same
 *  array, and this function does not care which produced any given entry. */
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
        if (skill !== undefined && !block.is_error) {
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
    const required = this.configLoader.config.requiredSkills[toolName] as string[] | undefined;
    if (required === undefined || required.length === 0) {
      return { allowed: true };
    }
    const loaded = loadedSkillNames(this.conversation);
    const missing = required.filter((skill: string) => !loaded.has(skill));
    return missing.length === 0 ? { allowed: true } : { allowed: false, missing };
  }
}
