import { resolve, sep } from 'node:path';
import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { AnyToolDefinition } from '@shellicar/claude-sdk';
import type { PermissionActionOutput } from './cli-config/types.js';

export enum PermissionAction {
  Approve = 0,
  Ask = 1,
  Deny = 2,
  // A tool (or, for a pipe, one of its steps) has no definition. Distinct from Deny: Deny is an
  // actual decision to reject; NotFound is a lookup failure. They must reach the model differently
  // — a missing tool must never be reported as a user rejection. Highest value so it dominates the
  // pipe's Math.max: a pipe with any unfound step is itself not-found.
  NotFound = 3,
}

export type ToolCall = { name: string; input: Record<string, unknown> };

// The Memory tools are frictionless by design: a persistent shared memory is
// not a filesystem action and the cwd-zone model does not apply. They approve
// regardless of the matrix (which would otherwise prompt on DeleteMemory's
// delete-default of 'ask'). Permissions, if ever wanted, are a separate system.
const FRICTIONLESS_TOOLS = new Set(['WriteMemory', 'ReadMemory', 'SearchMemory', 'DeleteMemory', 'MemoryTypes']);

type PipeStep = { tool: string; input: Record<string, unknown> };
type PipeInput = { steps: PipeStep[] };
type PipeToolCall = { name: 'Pipe'; input: PipeInput };

function isPipeTool(tool: ToolCall): tool is PipeToolCall {
  return tool.name === 'Pipe';
}

export type ZonePermissions = { read: PermissionAction; write: PermissionAction; delete: PermissionAction };
export type PermissionConfig = { default: ZonePermissions; outside: ZonePermissions };

type ZonePermissionsConfig = { read: PermissionActionOutput; write: PermissionActionOutput; delete: PermissionActionOutput };
type PermissionMatrixConfig = { default: ZonePermissionsConfig; outside: ZonePermissionsConfig };

const permissionActionByName = {
  approve: PermissionAction.Approve,
  ask: PermissionAction.Ask,
  deny: PermissionAction.Deny,
} satisfies Record<PermissionActionOutput, PermissionAction>;

/**
 * Maps the config-file permission matrix (string actions) onto the runtime
 * PermissionAction enum getPermission uses. Read live so a config hot-reload
 * takes effect on the next approval.
 */
export function buildPermissionMatrix(config: PermissionMatrixConfig): PermissionConfig {
  return {
    default: {
      read: permissionActionByName[config.default.read],
      write: permissionActionByName[config.default.write],
      delete: permissionActionByName[config.default.delete],
    },
    outside: {
      read: permissionActionByName[config.outside.read],
      write: permissionActionByName[config.outside.write],
      delete: permissionActionByName[config.outside.delete],
    },
  };
}

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
  if (FRICTIONLESS_TOOLS.has(tool.name)) {
    return PermissionAction.Approve;
  }
  if (isPipeTool(tool)) {
    if (tool.input.steps.length === 0) {
      return PermissionAction.Ask;
    }
    return Math.max(...tool.input.steps.map((s) => getPermission({ name: s.tool, input: s.input }, allTools, cwd, matrix, fs))) as PermissionAction;
  }

  const definition = allTools.find((t) => t.name === tool.name);
  if (!definition) {
    return PermissionAction.NotFound;
  }

  const operation = definition.operation ?? 'read';
  const rawPath = getPathFromInput(tool);
  const filePath = rawPath !== undefined ? expandPath(rawPath, fs) : undefined;
  const zone: 'default' | 'outside' = filePath !== undefined && !isInsideCwd(filePath, cwd) ? 'outside' : 'default';
  return matrix[zone][operation];
}

/** Names every tool with no definition — the top-level tool, or, for a pipe, each unfound step.
 *  Used to build the `tool not found` reason so the model is told the real cause, not a rejection. */
export function findUnknownTools(tool: ToolCall, allTools: AnyToolDefinition[]): string[] {
  if (isPipeTool(tool)) {
    return tool.input.steps.flatMap((s) => findUnknownTools({ name: s.tool, input: s.input }, allTools));
  }
  return allTools.some((t) => t.name === tool.name) ? [] : [tool.name];
}
