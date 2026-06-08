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

export function composeSystemPrompts(_inputs: SystemPromptInputs): string[] {
  throw new Error('not implemented');
}
