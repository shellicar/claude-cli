import { formatPermissionsDisplay, type PermissionsConfigInput } from '../cli-config/formatPermissionChange.js';

/**
 * Gates the 🔔 permissions notice so it appears only when the *displayed*
 * permissions change.
 *
 * The live path had no permissions-specific comparison: any config field change
 * (e.g. `model`) fired an unconditional splice of the permission matrix. This
 * unit holds the last displayed matrix and emits the notice only when the next
 * render differs.
 *
 * The baseline seeds from the already-loaded config at construction, so startup
 * prints nothing and the first change prints only on an actual permissions diff.
 */
export class PermissionsNoticeGate {
  #lastDisplay: string;

  public constructor(initialPermissions: PermissionsConfigInput) {
    this.#lastDisplay = formatPermissionsDisplay(initialPermissions);
  }

  /**
   * Given the next permissions config, return the rendered matrix to splice as a
   * notice when the displayed permissions changed, or `null` when the displayed
   * permissions are unchanged.
   */
  public update(permissions: PermissionsConfigInput): string | null {
    throw new Error('not implemented');
  }
}
