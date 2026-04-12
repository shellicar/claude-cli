import { basename } from 'node:path';
import { DIM, INVERSE_OFF, INVERSE_ON, RESET } from '@shellicar/claude-core/ansi';
import { wrapLine } from '@shellicar/claude-core/reflow';
import { StatusLineBuilder } from '@shellicar/claude-core/status-line';
import type { CommandModeState } from '../model/CommandModeState.js';

// Same indent used by renderConversation for block content lines.
const CONTENT_INDENT = '   ';

export type CommandModeRender = {
  commandRow: string;
  previewRows: string[];
};

/**
 * Render the command mode UI from pure state.
 *
 * Returns two separate pieces because they occupy different fixed positions in
 * the layout: commandRow sits between the approval row and content area;
 * previewRows are appended below commandRow and their count affects the
 * content area height calculation.
 *
 * maxTextLines caps how many lines of a text attachment are shown (caller passes
 * Math.max(1, Math.floor(totalRows / 3))). maxRows is the absolute cap on
 * previewRows length (caller passes Math.floor(totalRows / 2)).
 */
export function renderCommandMode(state: CommandModeState, conversationId: string, cols: number, maxTextLines: number, maxRows: number): CommandModeRender {
  return {
    commandRow: buildCommandRow(state, conversationId),
    previewRows: buildPreviewRows(state, cols, maxTextLines, maxRows),
  };
}

function buildCommandRow(state: CommandModeState, conversationId: string): string {
  const hasAttachments = state.hasAttachments;
  if (!state.commandMode && !hasAttachments) {
    return '';
  }
  const b = new StatusLineBuilder();
  b.text(' ');
  const atts = state.attachments;
  for (let i = 0; i < atts.length; i++) {
    const att = atts[i];
    if (!att) {
      continue;
    }
    let chip: string;
    if (att.kind === 'text') {
      if (att.truncated) {
        const fullStr = att.fullSizeBytes >= 1024 ? `${(att.fullSizeBytes / 1024).toFixed(1)}KB` : `${att.fullSizeBytes}B`;
        chip = `[txt ${fullStr}!]`;
      } else {
        const sizeStr = att.sizeBytes >= 1024 ? `${(att.sizeBytes / 1024).toFixed(1)}KB` : `${att.sizeBytes}B`;
        chip = `[txt ${sizeStr}]`;
      }
    } else {
      const name = basename(att.path);
      if (att.fileType === 'missing') {
        chip = `[${name} ?]`;
      } else if (att.fileType === 'dir') {
        chip = `[${name}/]`;
      } else {
        const sz = att.sizeBytes ?? 0;
        const sizeStr = sz >= 1024 ? `${(sz / 1024).toFixed(1)}KB` : `${sz}B`;
        chip = `[${name} ${sizeStr}]`;
      }
    }
    if (state.commandMode && i === state.selectedIndex) {
      b.ansi(INVERSE_ON);
      b.text(chip);
      b.ansi(INVERSE_OFF);
    } else {
      b.ansi(DIM);
      b.text(chip);
      b.ansi(RESET);
    }
    b.text(' ');
  }
  if (state.commandMode) {
    b.ansi(DIM);
    b.text('cmd');
    if (conversationId) {
      b.text(` [${conversationId.slice(0, 8)}]`);
    }
    b.ansi(RESET);
    if (hasAttachments) {
      b.text('  \u2190 \u2192 select  d del  p prev  \u00b7  t paste  \u00b7  f file  \u00b7  ESC cancel');
    } else {
      b.text('  t paste  \u00b7  f file  \u00b7  ESC cancel');
    }
  }
  return b.output;
}

function buildPreviewRows(state: CommandModeState, cols: number, maxTextLines: number, maxRows: number): string[] {
  // Preview is only visible when command mode is active and preview is toggled on.
  if (!state.commandMode || !state.previewMode) {
    return [];
  }
  const idx = state.selectedIndex;
  if (idx < 0) {
    return [];
  }
  const att = state.attachments[idx];
  if (!att) {
    return [];
  }

  const rows: string[] = [];
  if (att.kind === 'text') {
    if (att.truncated) {
      const showSize = att.sizeBytes >= 1024 ? `${(att.sizeBytes / 1024).toFixed(1)}KB` : `${att.sizeBytes}B`;
      const fullSize = att.fullSizeBytes >= 1024 ? `${(att.fullSizeBytes / 1024).toFixed(1)}KB` : `${att.fullSizeBytes}B`;
      rows.push(`${DIM}   showing ${showSize} of ${fullSize} (truncated)${RESET}`);
    }
    const lines = att.text.split('\n');
    for (const line of lines.slice(0, maxTextLines)) {
      rows.push(...wrapLine(CONTENT_INDENT + line, cols));
    }
    if (lines.length > maxTextLines) {
      rows.push(`${DIM}   \u2026 ${lines.length - maxTextLines} more lines${RESET}`);
    }
  } else {
    rows.push(`   path: ${att.path}`);
    if (att.fileType === 'file') {
      const sz = att.sizeBytes ?? 0;
      const sizeStr = sz >= 1024 ? `${(sz / 1024).toFixed(1)}KB` : `${sz}B`;
      rows.push(`   type: file  size: ${sizeStr}`);
    } else if (att.fileType === 'dir') {
      rows.push('   type: dir');
    } else {
      rows.push('   // not found');
    }
  }
  return rows.slice(0, maxRows);
}
