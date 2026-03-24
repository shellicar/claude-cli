import { PRESET_RULES } from './consts';
import type { ApproveRule, ExecPermissions } from './types';

export function collectRules(permissions: ExecPermissions): ApproveRule[] {
  const rules: ApproveRule[] = [];
  if (permissions.presets) {
    for (const preset of permissions.presets) {
      const presetRules = PRESET_RULES[preset];
      if (presetRules) {
        rules.push(...presetRules);
      }
    }
  }
  if (permissions.approve) {
    rules.push(...permissions.approve);
  }
  return rules;
}
