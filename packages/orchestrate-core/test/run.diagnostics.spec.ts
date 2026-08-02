import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { FakeApprover, FakeSleep, FakeTool, stage } from './fakes.js';

// A stage has two outputs: what the next stage reads, and what it has to say to whoever asked for
// the run. A process's stderr and a filter's "12 matched" are the same thing arriving the same way.
// Kept apart from the bytes, and kept per stage, so nothing has to decide how they interleave.

function options(overrides: { hold?: number } = {}) {
  return { decide: new FakeApprover().decide, sleep: new FakeSleep().sleep, hold: overrides.hold ?? 64 * 1024, ahead: 4096 };
}

describe('what a stage has to say', () => {
  it('comes back against the stage that said it', async () => {
    const tool = new FakeTool('Match', { writes: ['a.ts\n'], says: ['12 matched'] });

    const { stages } = await run([stage(tool)], options());

    const expected = ['12 matched'];
    const actual = stages[0]?.said;
    expect(actual).toEqual(expected);
  });

  it('does not reach the stage after it', async () => {
    const consumer = new FakeTool('Head', { echoes: true });

    const { output } = await run([stage(new FakeTool('Find', { writes: ['a.ts\n'], says: ['walked 400 directories'] }), '|'), stage(consumer)], options());

    const expected = 'a.ts\n';
    const actual = output.toString('utf8');
    expect(actual).toBe(expected);
  });

  it('is kept apart from what the run hands back', async () => {
    const tool = new FakeTool('Program', { writes: ['result\n'], says: ['warning: something'] });

    const { output } = await run([stage(tool)], options());

    const expected = 'result\n';
    const actual = output.toString('utf8');
    expect(actual).toBe(expected);
  });

  it('is kept per stage, so three stages do not merge into one account', async () => {
    const stages = [stage(new FakeTool('Find', { writes: ['a.ts\n'], says: ['walked 400'] }), '|'), stage(new FakeTool('Match', { echoes: true, says: ['12 matched'] }), '|'), stage(new FakeTool('Head', { echoes: true, says: ['stopped early'] }))];

    const { stages: reports } = await run(stages, options());

    const expected = [['walked 400'], ['12 matched'], ['stopped early']];
    const actual = reports.map((report) => report.said);
    expect(actual).toEqual(expected);
  });

  it('comes back even when the stage failed', async () => {
    const tool = new FakeTool('Program', { says: ['rm: no such file'], ends: { kind: 'failed', code: 1 } });

    const { stages } = await run([stage(tool)], options());

    const expected = ['rm: no such file'];
    const actual = stages[0]?.said;
    expect(actual).toEqual(expected);
  });

  it('comes back even when the stage was stopped early', async () => {
    const producer = new FakeTool('Find', { endless: true, says: ['walking'] });

    const { stages } = await run([stage(producer)], options({ hold: 128 }));

    const expected = ['walking'];
    const actual = stages[0]?.said;
    expect(actual).toEqual(expected);
  });

  it('is nothing at all for a stage with nothing to say', async () => {
    const { stages } = await run([stage(new FakeTool('Find', { writes: ['a.ts\n'] }))], options());

    const expected: string[] = [];
    const actual = stages[0]?.said;
    expect(actual).toEqual(expected);
  });

  it('is nothing for a stage that never ran', async () => {
    const failing = new FakeTool('Find', { ends: { kind: 'failed', code: 1 } });

    const { stages } = await run([stage(failing, '&&'), stage(new FakeTool('Report', { says: ['never happens'] }))], options());

    const expected: string[] = [];
    const actual = stages[1]?.said;
    expect(actual).toEqual(expected);
  });
});

// A stage with a great deal to say is bounded like anything else held whole, and being cut short
// there is not the same as the stage failing.
describe('a stage that says more than may be held', () => {
  it('keeps what fit and no more', async () => {
    const tool = new FakeTool('Program', { writes: ['out\n'], saysEndlessly: true });

    const { stages } = await run([stage(tool)], options({ hold: 128 }));

    const said = stages[0]?.said ?? [];
    const expected = true;
    const actual = said.length > 0 && said.join('').length <= 128;
    expect(actual).toBe(expected);
  });

  it('does not make the stage itself fail', async () => {
    const tool = new FakeTool('Program', { writes: ['out\n'], saysEndlessly: true });

    const { stages } = await run([stage(tool)], options({ hold: 128 }));

    const expected = 'finished';
    const actual = stages[0]?.ended.kind;
    expect(actual).toBe(expected);
  });
});
