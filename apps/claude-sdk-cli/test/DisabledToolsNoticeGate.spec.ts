import { describe, expect, it } from 'vitest';
import { DisabledToolsNoticeGate } from '../src/model/DisabledToolsNoticeGate.js';

describe('DisabledToolsNoticeGate', () => {
  it('emits nothing on the first update when nothing changed since construction', () => {
    const gate = new DisabledToolsNoticeGate(new Set(['AzCli']));
    const actual = gate.update(new Set(['AzCli']));
    expect(actual).toBeNull();
  });

  it('emits an enabled notice when a tool leaves the disabled set', () => {
    const gate = new DisabledToolsNoticeGate(new Set(['AzCli']));
    const actual = gate.update(new Set());
    expect(actual).toBe('\u{1f513} AzCli enabled');
  });

  it('emits a disabled notice when a tool enters the disabled set', () => {
    const gate = new DisabledToolsNoticeGate(new Set());
    const actual = gate.update(new Set(['AzCli']));
    expect(actual).toBe('\u{1f512} AzCli disabled');
  });

  it('lists multiple flips together, enabled before disabled', () => {
    const gate = new DisabledToolsNoticeGate(new Set(['AzCli']));
    const actual = gate.update(new Set(['EscalatedAzCli']));
    expect(actual).toBe('\u{1f513} AzCli enabled\n\u{1f512} EscalatedAzCli disabled');
  });

  it('does not re-fire on the next update once the new state is the baseline', () => {
    const gate = new DisabledToolsNoticeGate(new Set(['AzCli']));
    gate.update(new Set());
    const actual = gate.update(new Set());
    expect(actual).toBeNull();
  });

  it('ignores an unrelated tool name that is disabled in both the old and new set', () => {
    const gate = new DisabledToolsNoticeGate(new Set(['AzCli', 'ExecV3']));
    const actual = gate.update(new Set(['ExecV3']));
    expect(actual).toBe('\u{1f513} AzCli enabled');
  });
});
