import type { AnyToolDefinition } from '@shellicar/claude-sdk';
import type { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import type { AppTools } from '../createAppTools.js';

export class AppToolsService {
  public readonly tools: AnyToolDefinition[];
  public readonly store: RefStore;
  public readonly refTransform: (toolName: string, output: unknown) => unknown;

  public constructor(appTools: AppTools) {
    this.tools = appTools.tools;
    this.store = appTools.store;
    this.refTransform = appTools.refTransform;
  }
}
