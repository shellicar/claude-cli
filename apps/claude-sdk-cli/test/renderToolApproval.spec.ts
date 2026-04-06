import { describe, expect, it } from 'vitest';
import { renderToolApproval } from '../src/renderToolApproval.js';
import { ToolApprovalState } from '../src/ToolApprovalState.js';

const COLS = 120;
const MAX_ROWS = 10;

function emptyState(): ToolApprovalState {
  return new ToolApprovalState();
}

function stateWithTool(name = 'read_file', input: Record<string, unknown> = { path: '/tmp/foo' }): ToolApprovalState {
  const state = new ToolApprovalState();
  state.addTool({ requestId: 'a', name, input });
  return state;
}

function stateWithTwoTools(): ToolApprovalState {
  const state = new ToolApprovalState();
  state.addTool({ requestId: 'a', name: 'read_file', input: { path: '/tmp/foo' } });
  state.addTool({ requestId: 'b', name: 'write_file', input: { path: '/tmp/bar' } });
  return state;
}

// ---------------------------------------------------------------------------
// No tools
// ---------------------------------------------------------------------------

describe('renderToolApproval — no tools', () => {
  it('approvalRow is empty string when no tools', () => {
    const expected = '';
    const actual = renderToolApproval(emptyState(), COLS, MAX_ROWS).approvalRow;
    expect(actual).toBe(expected);
  });

  it('expandedRows is empty when no tools', () => {
    const expected = 0;
    const actual = renderToolApproval(emptyState(), COLS, MAX_ROWS).expandedRows.length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Single tool, no approval pending
// ---------------------------------------------------------------------------

describe('renderToolApproval — single tool, no approval', () => {
  it('approvalRow includes tool name', () => {
    const expected = true;
    const actual = renderToolApproval(stateWithTool('read_file'), COLS, MAX_ROWS).approvalRow.includes('read_file');
    expect(actual).toBe(expected);
  });

  it('approvalRow does not include [Y/N] when no approval pending', () => {
    const expected = false;
    const actual = renderToolApproval(stateWithTool(), COLS, MAX_ROWS).approvalRow.includes('[Y/N]');
    expect(actual).toBe(expected);
  });

  it('approvalRow does not include "Allow" when no approval pending', () => {
    const expected = false;
    const actual = renderToolApproval(stateWithTool(), COLS, MAX_ROWS).approvalRow.includes('Allow');
    expect(actual).toBe(expected);
  });

  it('approvalRow includes expand hint when not expanded', () => {
    const expected = true;
    const actual = renderToolApproval(stateWithTool(), COLS, MAX_ROWS).approvalRow.includes('[space: expand]');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Single tool, approval pending
// ---------------------------------------------------------------------------

describe('renderToolApproval — approval pending', () => {
  it('approvalRow includes [Y/N] when approval is pending', () => {
    const state = stateWithTool();
    state.requestApproval();
    const expected = true;
    const actual = renderToolApproval(state, COLS, MAX_ROWS).approvalRow.includes('[Y/N]');
    expect(actual).toBe(expected);
  });

  it('approvalRow includes "Allow" when approval is pending', () => {
    const state = stateWithTool();
    state.requestApproval();
    const expected = true;
    const actual = renderToolApproval(state, COLS, MAX_ROWS).approvalRow.includes('Allow');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Multiple tools — navigation counter
// ---------------------------------------------------------------------------

describe('renderToolApproval — multiple tools', () => {
  it('approvalRow includes 1/2 counter for first of two tools', () => {
    const expected = true;
    const actual = renderToolApproval(stateWithTwoTools(), COLS, MAX_ROWS).approvalRow.includes('1/2');
    expect(actual).toBe(expected);
  });

  it('approvalRow includes 2/2 counter after selectNext', () => {
    const state = stateWithTwoTools();
    state.selectNext();
    const expected = true;
    const actual = renderToolApproval(state, COLS, MAX_ROWS).approvalRow.includes('2/2');
    expect(actual).toBe(expected);
  });

  it('approvalRow does not include counter for single tool', () => {
    const expected = false;
    const actual = renderToolApproval(stateWithTool(), COLS, MAX_ROWS).approvalRow.includes('1/1');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Expand / collapse
// ---------------------------------------------------------------------------

describe('renderToolApproval — expanded', () => {
  it('expandedRows is empty when not expanded', () => {
    const expected = 0;
    const actual = renderToolApproval(stateWithTool(), COLS, MAX_ROWS).expandedRows.length;
    expect(actual).toBe(expected);
  });

  it('expandedRows is non-empty when expanded', () => {
    const state = stateWithTool();
    state.toggleExpanded();
    const expected = true;
    const actual = renderToolApproval(state, COLS, MAX_ROWS).expandedRows.length > 0;
    expect(actual).toBe(expected);
  });

  it('approvalRow includes [space: collapse] when expanded', () => {
    const state = stateWithTool();
    state.toggleExpanded();
    const expected = true;
    const actual = renderToolApproval(state, COLS, MAX_ROWS).approvalRow.includes('[space: collapse]');
    expect(actual).toBe(expected);
  });

  it('expandedRows contains JSON content from tool input', () => {
    const state = stateWithTool('read_file', { path: '/tmp/unique-path-xyz' });
    state.toggleExpanded();
    const rows = renderToolApproval(state, COLS, MAX_ROWS).expandedRows;
    const expected = true;
    const actual = rows.some((r) => r.includes('unique-path-xyz'));
    expect(actual).toBe(expected);
  });

  it('expandedRows is capped at maxRows', () => {
    // Large input that would produce more rows than the cap
    const bigInput: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      bigInput[`key${i}`] = `value${i}`;
    }
    const state = stateWithTool('heavy_tool', bigInput);
    state.toggleExpanded();
    const cap = 3;
    const expected = true;
    const actual = renderToolApproval(state, COLS, cap).expandedRows.length <= cap;
    expect(actual).toBe(expected);
  });
});
