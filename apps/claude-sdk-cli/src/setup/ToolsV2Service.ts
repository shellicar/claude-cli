import type { BetaTool } from '@anthropic-ai/sdk/resources/beta.mjs';
import { toolsV2WireTools } from '@shellicar/claude-sdk-tools/Orchestrate';
import type { ToolsV2Registry } from '@shellicar/claude-sdk-tools/Orchestrate';

/** Holds the one Tools V2 registry the process constructs, and its derived wire entries \u2014
 *  the composition-root equivalent of `AppToolsService` for V1, kept genuinely separate. */
export class ToolsV2Service {
  public readonly registry: ToolsV2Registry;
  public readonly wireTools: BetaTool[];

  public constructor(registry: ToolsV2Registry) {
    this.registry = registry;
    this.wireTools = toolsV2WireTools(registry);
  }
}
