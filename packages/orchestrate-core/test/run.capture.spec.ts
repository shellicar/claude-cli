import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { FakeApprover, FakeSleep, FakeTool, stage } from './fakes.js';

// A capture is a stage's whole output, named. It reaches a later command through the environment
// that command runs under, and never through anything that is published or shown.

function options(overrides: { captures?: Map<string, string>; approver?: FakeApprover } = {}) {
  return {
    decide: (overrides.approver ?? new FakeApprover()).decide,
    sleep: new FakeSleep().sleep,
    hold: 64 * 1024,
    ahead: 4096,
    capture: (name: string, value: string) => void (overrides.captures ?? new Map()).set(name, value),
  };
}

function captured(stageDef: ReturnType<typeof stage>, name: string): ReturnType<typeof stage> {
  return { ...stageDef, captureAs: name } as ReturnType<typeof stage>;
}

describe('a stage that names its output', () => {
  it('captures everything it produced', async () => {
    const captures = new Map<string, string>();
    const tool = new FakeTool('AzCli', { writes: ['secret-', 'token'] });

    await run([captured(stage(tool), 'TOKEN')], options({ captures }));

    const expected = 'secret-token';
    const actual = captures.get('TOKEN');
    expect(actual).toBe(expected);
  });

  it('captures its own output rather than the pipeline it sits in', async () => {
    const captures = new Map<string, string>();
    const first = new FakeTool('AzCli', { writes: ['mine\n'] });
    const second = new FakeTool('Program', { writes: ['theirs\n'] });

    await run([captured(stage(first, '|'), 'MINE'), stage(second)], options({ captures }));

    const expected = 'mine\n';
    const actual = captures.get('MINE');
    expect(actual).toBe(expected);
  });

  it('still hands its output to the stage after it', async () => {
    const consumer = new FakeTool('Program', { echoes: true });

    const { output } = await run([captured(stage(new FakeTool('AzCli', { writes: ['value\n'] }), '|'), 'TOKEN'), stage(consumer)], options());

    const expected = 'value\n';
    const actual = output.toString('utf8');
    expect(actual).toBe(expected);
  });

  it('is not captured when the stage was refused', async () => {
    const captures = new Map<string, string>();
    const refuser = new FakeApprover({ AzCli: { verdict: 'refuse' } });

    await run([captured(stage(new FakeTool('AzCli', { writes: ['secret'] })), 'TOKEN')], options({ captures, approver: refuser }));

    const expected = undefined;
    const actual = captures.get('TOKEN');
    expect(actual).toBe(expected);
  });
});

// The value reaches a command through the environment it runs under, and by no other route. A
// stage's input is what a decision is made on and what is published, so a captured value put there
// would be exposed by the asking rather than by the answer.
describe('a later stage that names a capture in its input', () => {
  it('receives the name, not the value', async () => {
    const captures = new Map<string, string>();
    const later = new FakeTool('Program');

    await run([captured(stage(new FakeTool('AzCli', { writes: ['secret-token'] })), 'TOKEN'), stage(later, undefined, { args: ['Bearer $TOKEN'] })], options({ captures }));

    const expected = ['Bearer $TOKEN'];
    const actual = (later.input as { args: string[] }).args;
    expect(actual).toEqual(expected);
  });

  it('is judged on the name, not the value', async () => {
    const looker = new FakeApprover();
    const captures = new Map<string, string>();

    await run([captured(stage(new FakeTool('AzCli', { writes: ['secret-token'] })), 'TOKEN'), stage(new FakeTool('Program'), undefined, { args: ['Bearer $TOKEN'] })], { ...options({ captures }), decide: looker.decide });

    const expected = false;
    const actual = JSON.stringify(looker.asked).includes('secret-token');
    expect(actual).toBe(expected);
  });
});
