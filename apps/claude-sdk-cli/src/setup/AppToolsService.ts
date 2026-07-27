import type { AnyToolDefinition } from '@shellicar/claude-sdk';
import type { AzDeps, AzSessionCache } from '@shellicar/claude-sdk-tools/Az';
import type { AdoEscalatedDeps } from '@shellicar/claude-sdk-tools/AzureDevOps';
import type { GhEscalatedDeps } from '@shellicar/claude-sdk-tools/GitHub';
import type { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import type { AppTools } from '../createAppTools.js';
import type { PermissionTool } from '../permissions.js';

export class AppToolsService {
  public readonly tools: AnyToolDefinition[];
  public readonly permissionTools: PermissionTool[];
  public readonly store: RefStore;
  public readonly refTransform: (toolName: string, output: unknown) => unknown;
  public readonly ghDeps: GhEscalatedDeps;
  public readonly adoDeps: AdoEscalatedDeps;
  public readonly azDeps: AzDeps;
  public readonly azSessionCache: AzSessionCache;

  public constructor(appTools: AppTools) {
    this.tools = appTools.tools;
    this.permissionTools = appTools.permissionTools;
    this.store = appTools.store;
    this.refTransform = appTools.refTransform;
    this.ghDeps = appTools.ghDeps;
    this.adoDeps = appTools.adoDeps;
    this.azDeps = appTools.azDeps;
    this.azSessionCache = appTools.azSessionCache;
  }
}
