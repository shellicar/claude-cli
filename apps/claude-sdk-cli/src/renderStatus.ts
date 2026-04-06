import { StatusLineBuilder } from '@shellicar/claude-core/status-line';
import type { StatusState } from './StatusState.js';

function formatTokens(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}

/**
 * Pure renderer: given the current status state, produce a single status line string.
 * Returns an empty string if no usage has been recorded yet.
 */
export function renderStatus(state: StatusState, _cols: number): string {
  if (state.totalInputTokens === 0 && state.totalOutputTokens === 0 && state.totalCacheCreationTokens === 0) {
    return '';
  }
  const b = new StatusLineBuilder();
  b.text(` in: ${formatTokens(state.totalInputTokens)}`);
  if (state.totalCacheCreationTokens > 0) {
    b.text(`  \u2191${formatTokens(state.totalCacheCreationTokens)}`);
  }
  if (state.totalCacheReadTokens > 0) {
    b.text(`  \u2193${formatTokens(state.totalCacheReadTokens)}`);
  }
  b.text(`  out: ${formatTokens(state.totalOutputTokens)}`);
  b.text(`  $${state.totalCostUsd.toFixed(4)}`);
  if (state.contextWindow > 0) {
    const pct = ((state.lastContextUsed / state.contextWindow) * 100).toFixed(1);
    b.text(`  ctx: ${formatTokens(state.lastContextUsed)}/${formatTokens(state.contextWindow)} (${pct}%)`);
  }
  return b.output;
}
