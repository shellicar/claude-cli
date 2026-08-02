import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import type { Stage } from '../src/types.js';
import { FakeApprover, FakeSleep, FakeTool, stage } from './fakes.js';

// `TOKEN=$(echo hello)` is two things: a command, and a name bound to what it produced. The command
// is unchanged by being captured — it writes to its output and knows nothing about where that goes.
// So binding the name is its own stage, reading what the stage before it produced, the same shape
// as an Xargs stage.

function options(overrides: { names?: Map<string, string>; approver?: FakeApprover; hold?: number } = {}) {
  return {
    decide: (overrides.approver ?? new FakeApprover()).decide,
    sleep: new FakeSleep().sleep,
    hold: overrides.hold ?? 64 * 1024,
    ahead: 4096,
    bind: (name: string, value: string) => void (overrides.names ?? new Map()).set(name, value),
  };
}

const set = (name: string): Stage => ({ kind: 'set', name });

describe('a stage that binds a name to what came before it', () => {
  it('binds everything that stage produced', async () => {
    const names = new Map<string, string>();

    await run([stage(new FakeTool('AzCli', { writes: ['secret-', 'token'] }), '|'), set('TOKEN')], options({ names }));

    const expected = 'secret-token';
    const actual = names.get('TOKEN');
    expect(actual).toBe(expected);
  });

  it('binds what that stage produced, not what the run ends up with', async () => {
    const names = new Map<string, string>();

    await run([stage(new FakeTool('AzCli', { writes: ['mine\n'] }), '|'), set('MINE'), stage(new FakeTool('Program', { writes: ['theirs\n'] }))], options({ names }));

    const expected = 'mine\n';
    const actual = names.get('MINE');
    expect(actual).toBe(expected);
  });

  it('leaves the stage that produced it ending as it would have anyway', async () => {
    const { stages } = await run([stage(new FakeTool('AzCli', { writes: ['value\n'] }), '|'), set('TOKEN')], options());

    const expected = { kind: 'finished' };
    const actual = stages[0]?.ended;
    expect(actual).toEqual(expected);
  });

  it('binds nothing when the stage before it was refused', async () => {
    const names = new Map<string, string>();
    const refuser = new FakeApprover({ AzCli: { verdict: 'refuse' } });

    await run([stage(new FakeTool('AzCli', { writes: ['secret'] }), '|'), set('TOKEN')], options({ names, approver: refuser }));

    const expected = undefined;
    const actual = names.get('TOKEN');
    expect(actual).toBe(expected);
  });

  it('binds nothing when what came before it is more than may be held', async () => {
    const names = new Map<string, string>();

    await run([stage(new FakeTool('AzCli', { endless: true }), '|'), set('TOKEN')], options({ names, hold: 128 }));

    const expected = undefined;
    const actual = names.get('TOKEN');
    expect(actual).toBe(expected);
  });
});

// The value reaches a command through the environment it runs under. A stage's input is what a
// decision is made on and what is published, so a bound value put there would be exposed by the
// asking rather than by the answer.
describe('a later stage that names a bound value in its input', () => {
  it('receives the name, not the value', async () => {
    const later = new FakeTool('Program');

    await run([stage(new FakeTool('AzCli', { writes: ['secret-token'] }), '|'), set('TOKEN'), stage(later, undefined, { args: ['Bearer $TOKEN'] })], options());

    const expected = ['Bearer $TOKEN'];
    const actual = (later.input as { args: string[] }).args;
    expect(actual).toEqual(expected);
  });

  it('is judged on the name, not the value', async () => {
    const looker = new FakeApprover();

    await run([stage(new FakeTool('AzCli', { writes: ['secret-token'] }), '|'), set('TOKEN'), stage(new FakeTool('Program'), undefined, { args: ['Bearer $TOKEN'] })], { ...options(), decide: looker.decide });

    const expected = false;
    const actual = JSON.stringify(looker.asked).includes('secret-token');
    expect(actual).toBe(expected);
  });
});
