import { BOLD_WHITE, RESET, YELLOW } from '@shellicar/claude-core/ansi';
import { StatusLineBuilder } from '@shellicar/claude-core/status-line';
import type { StatusState } from '../model/StatusState.js';
import { parseModelName } from './parseModelName.js';

/**
 * Returns the model name line, or just the label when no model is set.
 *
 * Composition:
 *   ⚡ <Name> [<version>][*]   <label>[  <conversationId>]
 *
 * The `*` after the model marks an override (--model at launch, or the
 * later command-mode toggle from issue #309). The `*` is a suffix, not a
 * prefix, so it does not collide visually with the *<sessionName> form.
 */
export function renderModel(state: StatusState, _cols: number, conversationId: string): string {
  const label = state.sessionName != null ? `${BOLD_WHITE}*${state.sessionName}${RESET}` : state.cwdBasename;
  const model = state.model;
  const idSuffix = state.showConversationId && conversationId ? `  ${conversationId}` : '';
  if (!model) {
    return ` ${label}${idSuffix}`;
  }
  const { name, version } = parseModelName(model);
  const versionPart = version != null ? ` ${version}` : '';
  const overridePart = state.isModelOverridden ? '*' : '';
  return ` ${YELLOW}⚡ ${name}${versionPart}${overridePart}${RESET}  ${label}${idSuffix}`;
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
