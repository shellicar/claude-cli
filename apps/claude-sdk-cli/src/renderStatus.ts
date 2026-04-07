import { RESET, YELLOW } from '@shellicar/claude-core/ansi';
import { StatusLineBuilder } from '@shellicar/claude-core/status-line';
import type { StatusState } from './StatusState.js';

/**
 * Extracts the model family name and capitalises it.
 * Handles both name styles:
 *   claude-sonnet-4-6        -> Sonnet
 *   claude-3-5-sonnet-20241022 -> Sonnet
 * Skips 'claude' and any purely-numeric parts to find the family word.
 */
function abbreviateModel(model: string): string {
  const parts = model.split('-');
  const name = parts.find((p, i) => i > 0 && !/^\d/.test(p));
  if (!name) {
    return model;
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Returns the model name line, or empty string if no model is set yet.
 */
export function renderModel(state: StatusState, _cols: number): string {
  const model = state.model;
  if (!model) {
    return '';
  }
  return ` ${YELLOW}⚡ ${abbreviateModel(model)}${RESET}`;
}

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
