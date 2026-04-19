import { spawn } from 'node:child_process';
import type { SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalNotifier } from '../src/model/ApprovalNotifier.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

const mockSpawn = vi.mocked(spawn);

const testRequest: SdkToolApprovalRequest = {
  type: 'tool_approval_request',
  requestId: 'req-1',
  name: 'DeleteFile',
  input: { path: '/tmp/test.ts' },
};

const testConfig = { command: '/path/to/script.sh', delayMs: 1000 };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  mockSpawn.mockReturnValue({ unref: vi.fn() } as ReturnType<typeof spawn>);
});

afterEach(() => {
  vi.useRealTimers();
  mockSpawn.mockReset();
});

// ---------------------------------------------------------------------------
// ApprovalNotifier
// ---------------------------------------------------------------------------

describe('ApprovalNotifier — runs after delay', () => {
  it('runs the command after the delay when approval is pending', () => {
    const notifier = new ApprovalNotifier(testConfig);
    notifier.start(testRequest);
    vi.advanceTimersByTime(testConfig.delayMs);
    const expected = 1;
    const actual = mockSpawn.mock.calls.length;
    expect(actual).toBe(expected);
  });
});

describe('ApprovalNotifier — cancel before delay', () => {
  it('cancels the timer when approval is resolved before the delay', () => {
    const notifier = new ApprovalNotifier(testConfig);
    notifier.start(testRequest);
    notifier.cancel();
    vi.advanceTimersByTime(testConfig.delayMs);
    const expected = 0;
    const actual = mockSpawn.mock.calls.length;
    expect(actual).toBe(expected);
  });
});

describe('ApprovalNotifier — null config', () => {
  it('does nothing when approvalNotify is null (not configured)', () => {
    const notifier = new ApprovalNotifier(null);
    notifier.start(testRequest);
    vi.advanceTimersByTime(10_000);
    const expected = 0;
    const actual = mockSpawn.mock.calls.length;
    expect(actual).toBe(expected);
  });
});

describe('ApprovalNotifier — passes request as JSON', () => {
  it('passes the approval request as a JSON string argument to the command', () => {
    const notifier = new ApprovalNotifier(testConfig);
    notifier.start(testRequest);
    vi.advanceTimersByTime(testConfig.delayMs);
    const expected = JSON.stringify(testRequest);
    const actual = mockSpawn.mock.calls[0]?.[1]?.[0];
    expect(actual).toBe(expected);
  });
});

describe('ApprovalNotifier — fire and forget', () => {
  it('does not throw if the command fails', () => {
    mockSpawn.mockImplementation(() => {
      throw new Error('spawn failed');
    });
    const notifier = new ApprovalNotifier(testConfig);
    notifier.start(testRequest);
    const actual = () => vi.advanceTimersByTime(testConfig.delayMs);
    expect(actual).not.toThrow();
  });
});
