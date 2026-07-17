import { describe, expect, it } from 'vitest';
import type { PendingTool } from '../src/model/ToolApprovalState.js';
import { ToolApprovalState } from '../src/model/ToolApprovalState.js';

const toolA = { requestId: 'a', name: 'read_file', input: { path: '/tmp/foo' } };
const toolB = { requestId: 'b', name: 'write_file', input: { path: '/tmp/bar', content: 'hi' } };

describe('ToolApprovalState — initial state', () => {
  it('pendingTools starts empty', () => {
    const state = new ToolApprovalState();
    const expected = 0;
    const actual = state.pendingTools.length;
    expect(actual).toBe(expected);
  });

  it('selectedTool starts at 0', () => {
    const state = new ToolApprovalState();
    const expected = 0;
    const actual = state.selectedTool;
    expect(actual).toBe(expected);
  });

  it('toolExpanded starts false', () => {
    const state = new ToolApprovalState();
    const expected = false;
    const actual = state.toolExpanded;
    expect(actual).toBe(expected);
  });

  it('hasPendingTools is false when empty', () => {
    const state = new ToolApprovalState();
    const expected = false;
    const actual = state.hasPendingTools;
    expect(actual).toBe(expected);
  });

  it('hasPendingApprovals is false when empty', () => {
    const state = new ToolApprovalState();
    const expected = false;
    const actual = state.hasPendingApprovals;
    expect(actual).toBe(expected);
  });
});

describe('ToolApprovalState — addTool', () => {
  it('adds a tool to pendingTools', () => {
    const state = new ToolApprovalState();
    state.addTool(toolA);
    const expected = 1;
    const actual = state.pendingTools.length;
    expect(actual).toBe(expected);
  });

  it('first tool resets selection to 0', () => {
    const state = new ToolApprovalState();
    state.addTool(toolA);
    const expected = 0;
    const actual = state.selectedTool;
    expect(actual).toBe(expected);
  });

  it('second tool does not change selection', () => {
    const state = new ToolApprovalState();
    state.addTool(toolA);
    state.addTool(toolB);
    const expected = 0;
    const actual = state.selectedTool;
    expect(actual).toBe(expected);
  });

  it('hasPendingTools becomes true after addTool', () => {
    const state = new ToolApprovalState();
    state.addTool(toolA);
    const expected = true;
    const actual = state.hasPendingTools;
    expect(actual).toBe(expected);
  });
});

describe('ToolApprovalState — removeTool', () => {
  it('returns true when requestId is found', () => {
    const state = new ToolApprovalState();
    state.addTool(toolA);
    const expected = true;
    const actual = state.removeTool('a');
    expect(actual).toBe(expected);
  });

  it('removes the tool from pendingTools', () => {
    const state = new ToolApprovalState();
    state.addTool(toolA);
    state.removeTool('a');
    const expected = 0;
    const actual = state.pendingTools.length;
    expect(actual).toBe(expected);
  });

  it('returns false when requestId is not found', () => {
    const state = new ToolApprovalState();
    state.addTool(toolA);
    const expected = false;
    const actual = state.removeTool('z');
    expect(actual).toBe(expected);
  });

  it('clamps selectedTool when removing selected last tool', () => {
    const state = new ToolApprovalState();
    state.addTool(toolA);
    state.addTool(toolB);
    state.selectNext(); // selectedTool = 1
    state.removeTool('b');
    const expected = 0;
    const actual = state.selectedTool;
    expect(actual).toBe(expected);
  });
});

describe('ToolApprovalState — clearTools', () => {
  it('empties pendingTools', () => {
    const state = new ToolApprovalState();
    state.addTool(toolA);
    state.addTool(toolB);
    state.clearTools();
    const expected = 0;
    const actual = state.pendingTools.length;
    expect(actual).toBe(expected);
  });
});

describe('ToolApprovalState — requestApproval / resolveApproval / resolveSelected', () => {
  const tool = (requestId: string): PendingTool => ({ requestId, name: 'DeleteFile', input: {} });

  it('resolveApproval with empty queue returns false', () => {
    const state = new ToolApprovalState();
    const expected = false;
    const actual = state.resolveApproval('r1', true);
    expect(actual).toBe(expected);
  });

  it('requestApproval resolves with true when its id is approved', async () => {
    const state = new ToolApprovalState();
    const promise = state.requestApproval('r1');
    state.resolveApproval('r1', true);
    const expected = true;
    const actual = await promise;
    expect(actual).toBe(expected);
  });

  it('requestApproval resolves with false when its id is denied', async () => {
    const state = new ToolApprovalState();
    const promise = state.requestApproval('r1');
    state.resolveApproval('r1', false);
    const expected = false;
    const actual = await promise;
    expect(actual).toBe(expected);
  });

  it('resolveApproval returns true when a pending approval exists for the id', () => {
    const state = new ToolApprovalState();
    state.requestApproval('r1');
    const expected = true;
    const actual = state.resolveApproval('r1', true);
    expect(actual).toBe(expected);
  });

  it('hasPendingApprovals is true after requestApproval', () => {
    const state = new ToolApprovalState();
    state.requestApproval('r1');
    const expected = true;
    const actual = state.hasPendingApprovals;
    expect(actual).toBe(expected);
  });

  it('resolveApproval settles only the named id, leaving others pending', () => {
    const state = new ToolApprovalState();
    state.requestApproval('r1');
    state.requestApproval('r2');
    state.resolveApproval('r1', true);
    const expected = true;
    const actual = state.hasPendingApprovals; // r2 still queued
    expect(actual).toBe(expected);
  });

  it('each id resolves to its own answer regardless of order', async () => {
    const state = new ToolApprovalState();
    const p1 = state.requestApproval('r1');
    const p2 = state.requestApproval('r2');
    state.resolveApproval('r2', false);
    state.resolveApproval('r1', true);
    const results = await Promise.all([p1, p2]);
    const expected = [true, false];
    const actual = results;
    expect(actual).toEqual(expected);
  });

  it('resolveSelected settles the selected tool, not the queue head', async () => {
    const state = new ToolApprovalState();
    state.addTool(tool('r1'));
    state.addTool(tool('r2'));
    const p1 = state.requestApproval('r1');
    const p2 = state.requestApproval('r2');
    state.selectNext(); // select r2
    state.resolveSelected(false);
    const settledFirst = await Promise.race([p2.then(() => 'r2'), p1.then(() => 'r1')]);
    const expected = 'r2';
    const actual = settledFirst;
    expect(actual).toBe(expected);
  });

  it('resolveSelected leaves the unselected tool pending', () => {
    const state = new ToolApprovalState();
    state.addTool(tool('r1'));
    state.addTool(tool('r2'));
    state.requestApproval('r1');
    state.requestApproval('r2');
    state.selectNext(); // select r2
    state.resolveSelected(false);
    const expected = true;
    const actual = state.hasPendingApprovals; // r1 still pending
    expect(actual).toBe(expected);
  });

  it('resolveSelected returns false when no tool is pending', () => {
    const state = new ToolApprovalState();
    const expected = false;
    const actual = state.resolveSelected(true);
    expect(actual).toBe(expected);
  });
});

describe('ToolApprovalState — navigation', () => {
  it('toggleExpanded flips toolExpanded from false to true', () => {
    const state = new ToolApprovalState();
    state.toggleExpanded();
    const expected = true;
    const actual = state.toolExpanded;
    expect(actual).toBe(expected);
  });

  it('toggleExpanded flips toolExpanded from true to false', () => {
    const state = new ToolApprovalState();
    state.toggleExpanded();
    state.toggleExpanded();
    const expected = false;
    const actual = state.toolExpanded;
    expect(actual).toBe(expected);
  });

  it('selectPrev decrements selectedTool', () => {
    const state = new ToolApprovalState();
    state.addTool(toolA);
    state.addTool(toolB);
    state.selectNext(); // 0 -> 1
    state.selectPrev(); // 1 -> 0
    const expected = 0;
    const actual = state.selectedTool;
    expect(actual).toBe(expected);
  });

  it('selectPrev does not go below 0', () => {
    const state = new ToolApprovalState();
    state.addTool(toolA);
    state.selectPrev();
    const expected = 0;
    const actual = state.selectedTool;
    expect(actual).toBe(expected);
  });

  it('selectPrev preserves expanded state', () => {
    const state = new ToolApprovalState();
    state.addTool(toolA);
    state.addTool(toolB);
    state.selectNext();
    state.toggleExpanded();
    state.selectPrev();
    const expected = true;
    const actual = state.toolExpanded;
    expect(actual).toBe(expected);
  });

  it('selectNext increments selectedTool', () => {
    const state = new ToolApprovalState();
    state.addTool(toolA);
    state.addTool(toolB);
    state.selectNext();
    const expected = 1;
    const actual = state.selectedTool;
    expect(actual).toBe(expected);
  });

  it('selectNext does not exceed last index', () => {
    const state = new ToolApprovalState();
    state.addTool(toolA);
    state.selectNext();
    const expected = 0;
    const actual = state.selectedTool;
    expect(actual).toBe(expected);
  });

  it('selectNext preserves expanded state', () => {
    const state = new ToolApprovalState();
    state.addTool(toolA);
    state.addTool(toolB);
    state.toggleExpanded();
    state.selectNext();
    const expected = true;
    const actual = state.toolExpanded;
    expect(actual).toBe(expected);
  });

  it('resetExpanded sets toolExpanded to false', () => {
    const state = new ToolApprovalState();
    state.toggleExpanded();
    state.resetExpanded();
    const expected = false;
    const actual = state.toolExpanded;
    expect(actual).toBe(expected);
  });
});
