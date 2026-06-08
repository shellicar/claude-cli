import { describe, expect, it } from 'vitest';
import { ApprovalHandler } from '../src/controller/ApprovalHandler.js';
import type { PendingTool } from '../src/model/ToolApprovalState.js';
import { ToolApprovalState } from '../src/model/ToolApprovalState.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const tool = (requestId: string): PendingTool => ({ requestId, name: 'x', input: {} });

describe('ApprovalHandler — approvals', () => {
  it('resolves the next pending approval as approved on Y', async () => {
    const tools = new ToolApprovalState();
    let result: boolean | null = null;
    void tools.requestApproval().then((r) => {
      result = r;
    });
    new ApprovalHandler(tools).handleKey({ type: 'char', value: 'Y' });
    await flush();
    const expected = true;
    const actual = result;
    expect(actual).toBe(expected);
  });

  it('resolves the next pending approval as denied on N', async () => {
    const tools = new ToolApprovalState();
    let result: boolean | null = null;
    void tools.requestApproval().then((r) => {
      result = r;
    });
    new ApprovalHandler(tools).handleKey({ type: 'char', value: 'N' });
    await flush();
    const expected = false;
    const actual = result;
    expect(actual).toBe(expected);
  });
});

describe('ApprovalHandler — tool navigation', () => {
  it('toggles expanded on space when tools are pending', () => {
    const tools = new ToolApprovalState();
    tools.addTool(tool('r1'));
    new ApprovalHandler(tools).handleKey({ type: 'char', value: ' ' });
    const expected = true;
    const actual = tools.toolExpanded;
    expect(actual).toBe(expected);
  });

  it('selects the previous tool on left when tools are pending', () => {
    const tools = new ToolApprovalState();
    tools.addTool(tool('r1'));
    tools.addTool(tool('r2'));
    tools.selectNext();
    new ApprovalHandler(tools).handleKey({ type: 'left' });
    const expected = 0;
    const actual = tools.selectedTool;
    expect(actual).toBe(expected);
  });

  it('selects the next tool on right when tools are pending', () => {
    const tools = new ToolApprovalState();
    tools.addTool(tool('r1'));
    tools.addTool(tool('r2'));
    new ApprovalHandler(tools).handleKey({ type: 'right' });
    const expected = 1;
    const actual = tools.selectedTool;
    expect(actual).toBe(expected);
  });
});

describe('ApprovalHandler — nothing pending', () => {
  it('passes through when no tools or approvals are pending', () => {
    const tools = new ToolApprovalState();
    const expected = false;
    const actual = new ApprovalHandler(tools).handleKey({ type: 'char', value: 'Y' });
    expect(actual).toBe(expected);
  });
});
