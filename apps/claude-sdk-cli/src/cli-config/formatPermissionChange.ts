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
