import type { AnyToolDefinition } from '@shellicar/claude-sdk';
import type { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import type { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { TsServerService } from '@shellicar/claude-sdk-tools/TsService';
import { createAppTools } from '../createAppTools.js';

export class AppToolsService {
  public readonly tools: AnyToolDefinition[];
  public readonly store: RefStore;
  public readonly refTransform: (toolName: string, output: unknown) => unknown;

  public constructor(tsServer: TsServerService, configLoader: ConfigLoader<any>) {
    const result = createAppTools(tsServer, configLoader.config.tools);
    this.tools = result.tools;
    this.store = result.store;
    this.refTransform = result.refTransform;
  }
}
