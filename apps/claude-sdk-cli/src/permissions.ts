import { resolve, sep } from 'node:path';
import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { AnyToolDefinition } from '@shellicar/claude-sdk';

export enum PermissionAction {
  Approve = 0,
  Ask = 1,
  Deny = 2,
}

export type ToolCall = { name: string; input: Record<string, unknown> };

type PipeStep = { tool: string; input: Record<string, unknown> };
type PipeInput = { steps: PipeStep[] };
type PipeToolCall = { name: 'Pipe'; input: PipeInput };

function isPipeTool(tool: ToolCall): tool is PipeToolCall {
  return tool.name === 'Pipe';
}

export type ZonePermissions = { read: PermissionAction; write: PermissionAction; delete: PermissionAction };
export type PermissionConfig = { default: ZonePermissions; outside: ZonePermissions };

function getPathFromInput(tool: ToolCall): string | undefined {
  if (tool.name === 'PreviewEdit' || tool.name === 'EditFile') {
    return typeof tool.input.file === 'string' ? tool.input.file : undefined;
  }
  return typeof tool.input.path === 'string' ? tool.input.path : undefined;
}

function isInsideCwd(filePath: string, cwd: string): boolean {
  const resolved = resolve(filePath);
  return resolved === cwd || resolved.startsWith(cwd + sep);
}

export function getPermission(tool: ToolCall, allTools: AnyToolDefinition[], cwd: string, matrix: PermissionConfig, fs: IFileSystem): PermissionAction {
  if (isPipeTool(tool)) {
    if (tool.input.steps.length === 0) {
      return PermissionAction.Ask;
    }
    return Math.max(...tool.input.steps.map((s) => getPermission({ name: s.tool, input: s.input }, allTools, cwd, matrix, fs))) as PermissionAction;
  }

  const definition = allTools.find((t) => t.name === tool.name);
  if (!definition) {
    return PermissionAction.Deny;
  }

  const operation = definition.operation ?? 'read';
  const rawPath = getPathFromInput(tool);
  const filePath = rawPath !== undefined ? expandPath(rawPath, fs) : undefined;
  const zone: 'default' | 'outside' = filePath !== undefined && !isInsideCwd(filePath, cwd) ? 'outside' : 'default';
  return matrix[zone][operation];
}
