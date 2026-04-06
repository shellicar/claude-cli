import { wrapLine } from '@shellicar/claude-core/reflow';
import type { ToolApprovalState } from './ToolApprovalState.js';

const CONTENT_INDENT = '   ';

export type ToolApprovalRender = {
  approvalRow: string;
  expandedRows: string[];
};

/**
 * Render the tool approval UI from pure state.
 *
 * Returns two separate pieces because they occupy different fixed positions in
 * the layout: approvalRow sits between the status line and command row;
 * expandedRows are appended below the command row and their count affects the
 * content area height calculation.
 *
 * maxRows caps the expanded JSON display at half the screen height — the caller
 * computes Math.floor(totalRows / 2) and passes it in so this function stays
 * free of any screen reference.
 */
export function renderToolApproval(state: ToolApprovalState, cols: number, maxRows: number): ToolApprovalRender {
  const tool = state.pendingTools[state.selectedTool];

  // --- approval row ---
  let approvalRow = '';
  if (tool) {
    const total = state.pendingTools.length;
    const nav = total > 1 ? ` \u2190 ${state.selectedTool + 1}/${total} \u2192` : '';
    const prefix = state.hasPendingApprovals ? 'Allow ' : '';
    const approval = state.hasPendingApprovals ? '  [Y/N]' : '';
    const expand = state.toolExpanded ? ' [space: collapse]' : ' [space: expand]';
    approvalRow = ` ${prefix}Tool: ${tool.name}${nav}${approval}${expand}`;
  }

  // --- expanded rows ---
  let expandedRows: string[] = [];
  if (state.toolExpanded && tool) {
    const rows: string[] = [];
    for (const line of JSON.stringify(tool.input, null, 2).split('\n')) {
      rows.push(...wrapLine(CONTENT_INDENT + line, cols));
    }
    expandedRows = rows.slice(0, maxRows);
  }

  return { approvalRow, expandedRows };
}
