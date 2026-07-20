import { describe, expect, it } from 'vitest';
import { ExecV3 } from '../../src/entry/ExecV3';
import { call } from '../helpers';

// End-to-end proof that a timeout actually kills a real process: execSignal.spec.ts
// (default tier) proves the AbortSignal composition itself; this is the one thing
// that needs a real spawn — a real sleep, really killed by a real signal. The wiring
// (execSignal -> Executor.run's abort -> group-kill) is shared across Exec/ExecV2/ExecV3,
// so one tool proving it end-to-end is enough; the others don't need their own copy.
describe('timeout — sleep 5 killed at 100ms', () => {
  it('exit code is null (killed, not exited)', async () => {
    const result = await call(ExecV3, { intent: 'time out a long sleep', timeout: 100, commands: [{ program: 'sleep', args: ['5'] }] });
    const expected = null;
    const actual = result.results[0]?.exitCode;
    expect(actual).toBe(expected);
  });

  it('signal is set', async () => {
    const result = await call(ExecV3, { intent: 'time out a long sleep', timeout: 100, commands: [{ program: 'sleep', args: ['5'] }] });
    const expected = true;
    const actual = result.results[0]?.signal !== null;
    expect(actual).toBe(expected);
  });

  it('success is false', async () => {
    const result = await call(ExecV3, { intent: 'time out a long sleep', timeout: 100, commands: [{ program: 'sleep', args: ['5'] }] });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});
