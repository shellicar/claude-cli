import type { ResolvedCliConfig } from './types';

export function diffConfig(prev: ResolvedCliConfig, next: ResolvedCliConfig): string[] {
  const changes: string[] = [];

  const check = (key: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push(`${key}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    }
  };

  check('model', prev.model, next.model);
  check('maxTurns', prev.maxTurns, next.maxTurns);
  check('permissionTimeoutMs', prev.permissionTimeoutMs, next.permissionTimeoutMs);
  check('extendedPermissionTimeoutMs', prev.extendedPermissionTimeoutMs, next.extendedPermissionTimeoutMs);
  check('questionTimeoutMs', prev.questionTimeoutMs, next.questionTimeoutMs);
  check('drowningThreshold', prev.drowningThreshold, next.drowningThreshold);
  check('autoApproveEdits', prev.autoApproveEdits, next.autoApproveEdits);
  check('autoApproveReads', prev.autoApproveReads, next.autoApproveReads);
  check('expandTilde', prev.expandTilde, next.expandTilde);

  for (const group of ['git', 'usage'] as const) {
    const pg = prev.providers[group] as Record<string, boolean>;
    const ng = next.providers[group] as Record<string, boolean>;
    for (const key of Object.keys(pg)) {
      check(`providers.${group}.${key}`, pg[key], ng[key]);
    }
  }

  return changes;
}
