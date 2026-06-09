type PermissionActionString = 'approve' | 'ask' | 'deny';

type ZoneConfig = {
  read: PermissionActionString;
  write: PermissionActionString;
  delete: PermissionActionString;
};

export type PermissionsConfigInput = {
  default: ZoneConfig;
  outside: ZoneConfig;
};

function permissionsEqual(a: PermissionsConfigInput, b: PermissionsConfigInput): boolean {
  return (
    a.default.read === b.default.read &&
    a.default.write === b.default.write &&
    a.default.delete === b.default.delete &&
    a.outside.read === b.outside.read &&
    a.outside.write === b.outside.write &&
    a.outside.delete === b.outside.delete
  );
}

const ACTION_EMOJI: Record<PermissionActionString, string> = {
  approve: '✅',
  ask: '❔',
  deny: '❌',
};

function formatZone(zone: ZoneConfig): string {
  return `read ${ACTION_EMOJI[zone.read]}  write ${ACTION_EMOJI[zone.write]}  delete ${ACTION_EMOJI[zone.delete]}`;
}

function formatMatrix(permissions: PermissionsConfigInput): string {
  return `\uD83D\uDD11 Permissions\n  default  ${formatZone(permissions.default)}\n  outside  ${formatZone(permissions.outside)}`;
}

/** Format the current permission matrix for display (e.g. on first load). */
export function formatPermissionsDisplay(permissions: PermissionsConfigInput): string {
  return formatMatrix(permissions);
}

/**
 * Returns a display string when the permission matrix has changed, null if unchanged.
 * Safe to call unconditionally — the null return lets the caller skip the notice.
 */
export function formatPermissionChange(prev: PermissionsConfigInput, next: PermissionsConfigInput): string | null {
  if (permissionsEqual(prev, next)) {
    return null;
  }
  return formatMatrix(next);
}
