import { CYAN, DIM, RESET, UNDERLINE } from '@shellicar/claude-core/ansi';
import type { AppModeKey } from '../model/AppModeState.js';

const VIEWS: ReadonlyArray<{ key: AppModeKey; bind: string; label: string }> = [
  { key: 'primary', bind: 'F1', label: 'primary' },
  { key: 'history', bind: 'F2', label: 'history' },
];

/**
 * The view bar: one entry per view with its F-key bind, the active one in the
 * accent colour + underline (no fill), the others dimmed. Shown on the existing
 * footer chrome in every view; the active key comes from AppModeState. Accent is
 * CYAN — a proposal; the exact accent is gate-level visual treatment.
 */
export function renderViewBar(active: AppModeKey): string {
  return VIEWS.map(({ key, bind, label }) => {
    const text = `${bind} ${label}`;
    return key === active ? `${CYAN}${UNDERLINE}${text}${RESET}` : `${DIM}${text}${RESET}`;
  }).join('    ');
}
