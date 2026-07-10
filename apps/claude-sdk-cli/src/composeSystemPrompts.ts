/**
 * Assembles the ordered system-prompt blocks from the three configured
 * sources. Order: SYSTEM.md sections (already user, project, projectClaude,
 * local), then the sdk-config inline value, then the --system flag. SYSTEM.md
 * sections arrive already wrapped in `<system-md>` (SystemPromptLoader); the
 * --system flag text is wrapped here, mirroring CLAUDE.md's --claudeMd flag.
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
    blocks.push(`<system-md>\nContents of the --system launch flag:\n\n${flagText}\n</system-md>`);
  }
  return blocks;
}
