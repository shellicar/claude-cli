/**
 * Assembles the ordered system-prompt blocks from the three configured
 * sources. Order: SYSTEM.md sections (already user, project, projectClaude,
 * local), then the sdk-config inline value, then the --system flag.
 *
 * Each element becomes one entry in DurableConfig.systemPrompts.
 */
export type SystemPromptInputs = {
  fileSections: readonly string[];
  configText: string | null;
  flagText: string | null;
};

export function composeSystemPrompts({ fileSections, configText, flagText }: SystemPromptInputs): string[] {
  const blocks = [...fileSections];
  if (configText != null && configText.length > 0) {
    blocks.push(configText);
  }
  if (flagText != null && flagText.length > 0) {
    blocks.push(flagText);
  }
  return blocks;
}
