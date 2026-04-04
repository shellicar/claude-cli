import type { ApproveRule } from './types';

export const PRESET_RULES: Record<string, ApproveRule[]> = {
  defaults: [{ program: '~/.claude/skills/*/scripts/*.sh' }],
};
