import type { SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalNotifier } from '../src/model/ApprovalNotifier.js';
import { IProcessLauncher, type LaunchOptions } from '../src/model/IProcessLauncher.js';

// ---------------------------------------------------------------------------
// Test launchers
// ---------------------------------------------------------------------------

interface RecordedLaunch {
  readonly command: string;
  readonly options: LaunchOptions;
}

class RecordingLauncher extends IProcessLauncher {
  public calls: RecordedLaunch[] = [];

  public launch(command: string, options: LaunchOptions): void {
    this.calls.push({ command, options });
  }
}

class ThrowingLauncher extends IProcessLauncher {
  public launch(): void {
    throw new Error('spawn failed');
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// ApprovalNotifier
// ---------------------------------------------------------------------------

describe('ApprovalNotifier — runs after delay', () => {
  it('runs the command after the delay when approval is pending', () => {
    const launcher = new RecordingLauncher();
    const notifier = new ApprovalNotifier(testConfig, launcher);
    notifier.start(testRequest);
    vi.advanceTimersByTime(testConfig.delayMs);
    const expected = 1;
    const actual = launcher.calls.length;
    expect(actual).toBe(expected);
  });
});

describe('ApprovalNotifier — cancel before delay', () => {
  it('cancels the timer when approval is resolved before the delay', () => {
    const launcher = new RecordingLauncher();
    const notifier = new ApprovalNotifier(testConfig, launcher);
    notifier.start(testRequest);
    notifier.cancel();
    vi.advanceTimersByTime(testConfig.delayMs);
    const expected = 0;
    const actual = launcher.calls.length;
    expect(actual).toBe(expected);
  });
});

describe('ApprovalNotifier — null config', () => {
  it('does nothing when approvalNotify is null (not configured)', () => {
    const launcher = new RecordingLauncher();
    const notifier = new ApprovalNotifier(null, launcher);
    notifier.start(testRequest);
    vi.advanceTimersByTime(10_000);
    const expected = 0;
    const actual = launcher.calls.length;
    expect(actual).toBe(expected);
  });
});

describe('ApprovalNotifier — delivers request via stdin', () => {
  it('delivers the approval request as JSON on stdin', () => {
    const launcher = new RecordingLauncher();
    const notifier = new ApprovalNotifier(testConfig, launcher);
    notifier.start(testRequest);
    vi.advanceTimersByTime(testConfig.delayMs);
    const expected = JSON.stringify(testRequest);
    const actual = launcher.calls[0]?.options.stdin;
    expect(actual).toBe(expected);
  });

  it('does not pass the approval request as a command argument', () => {
    const launcher = new RecordingLauncher();
    const notifier = new ApprovalNotifier(testConfig, launcher);
    notifier.start(testRequest);
    vi.advanceTimersByTime(testConfig.delayMs);
    const expected = undefined;
    const actual = launcher.calls[0]?.options.args;
    expect(actual).toBe(expected);
  });
});

describe('ApprovalNotifier — fire and forget', () => {
  it('does not throw if the command fails', () => {
    const notifier = new ApprovalNotifier(testConfig, new ThrowingLauncher());
    notifier.start(testRequest);
    const actual = () => vi.advanceTimersByTime(testConfig.delayMs);
    expect(actual).not.toThrow();
  });
});
