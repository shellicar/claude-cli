import { describe, expect, it } from 'vitest';
import { ApprovalCoordinator } from '../src/private/ApprovalCoordinator.js';

describe('ApprovalCoordinator — cancel routing', () => {
  it('routes a cancel to query_cancel when no tool is running', () => {
    const coordinator = new ApprovalCoordinator();

    const expected = 'query_cancel';
    const actual = coordinator.handle({ type: 'cancel' });

    expect(actual).toBe(expected);
  });

  it('sets cancelled when no tool is running', () => {
    const coordinator = new ApprovalCoordinator();
    coordinator.handle({ type: 'cancel' });

    const expected = true;
    const actual = coordinator.cancelled;
    expect(actual).toBe(expected);
  });

  it('routes a cancel to tool_cancel while a tool is running', () => {
    const coordinator = new ApprovalCoordinator();
    coordinator.toolRunStarted(new AbortController());

    const expected = 'tool_cancel';
    const actual = coordinator.handle({ type: 'cancel' });

    expect(actual).toBe(expected);
  });

  it('leaves the query running on a tool-cancel', () => {
    const coordinator = new ApprovalCoordinator();
    coordinator.toolRunStarted(new AbortController());
    coordinator.handle({ type: 'cancel' });

    const expected = false;
    const actual = coordinator.cancelled;
    expect(actual).toBe(expected);
  });

  it('aborts the running tool controller on a tool-cancel', () => {
    const coordinator = new ApprovalCoordinator();
    const controller = new AbortController();
    coordinator.toolRunStarted(controller);
    coordinator.handle({ type: 'cancel' });

    const expected = true;
    const actual = controller.signal.aborted;
    expect(actual).toBe(expected);
  });

  it('escalates a second cancel to query_cancel while a tool is running', () => {
    const coordinator = new ApprovalCoordinator();
    coordinator.toolRunStarted(new AbortController());
    coordinator.handle({ type: 'cancel' });

    const expected = 'query_cancel';
    const actual = coordinator.handle({ type: 'cancel' });

    expect(actual).toBe(expected);
  });

  it('sets cancelled on the escalating second cancel', () => {
    const coordinator = new ApprovalCoordinator();
    coordinator.toolRunStarted(new AbortController());
    coordinator.handle({ type: 'cancel' });
    coordinator.handle({ type: 'cancel' });

    const expected = true;
    const actual = coordinator.cancelled;
    expect(actual).toBe(expected);
  });
});
