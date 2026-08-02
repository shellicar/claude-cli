import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { FakeApprover, FakeSleep, FakeTool, stage } from './fakes.js';

// The engine, with everything below it faked. A tool answers for itself; the run answers for
// everything the tool cannot know.

const approver = () => new FakeApprover();
const sleep = () => new FakeSleep();

function options(overrides: { approver?: FakeApprover; sleep?: FakeSleep; hold?: number; ahead?: number } = {}) {
  return {
    decide: (overrides.approver ?? approver()).decide,
    sleep: (overrides.sleep ?? sleep()).sleep,
    hold: overrides.hold ?? 64 * 1024,
    ahead: overrides.ahead ?? 4096,
  };
}

describe('a stage that runs to the end', () => {
  it('reports what its tool said about itself', async () => {
    const tool = new FakeTool('Find', { writes: ['a.ts\n'] });

    const { stages } = await run([stage(tool)], options());

    const expected = { kind: 'finished' };
    const actual = stages[0]?.ended;
    expect(actual).toEqual(expected);
  });

  it('reports a failure its tool declared', async () => {
    const tool = new FakeTool('Program', { writes: [], ends: { kind: 'failed', code: 2 } });

    const { stages } = await run([stage(tool)], options());

    const expected = { kind: 'failed', code: 2 };
    const actual = stages[0]?.ended;
    expect(actual).toEqual(expected);
  });

  it('reports a signal its tool declared', async () => {
    const tool = new FakeTool('Program', { writes: [], ends: { kind: 'signalled', signal: 'SIGPIPE' } });

    const { stages } = await run([stage(tool)], options());

    const expected = { kind: 'signalled', signal: 'SIGPIPE' };
    const actual = stages[0]?.ended;
    expect(actual).toEqual(expected);
  });

  it('hands back what the last stage wrote', async () => {
    const tool = new FakeTool('Find', { writes: ['a.ts\n', 'b.ts\n'] });

    const { output } = await run([stage(tool)], options());

    const expected = 'a.ts\nb.ts\n';
    const actual = output.toString('utf8');
    expect(actual).toBe(expected);
  });
});

describe('a stage that throws', () => {
  it('is reported as having thrown', async () => {
    const boom = new Error('exploded');
    const tool = new FakeTool('Find', { throws: boom });

    const { stages } = await run([stage(tool)], options());

    const expected = { kind: 'threw', error: boom };
    const actual = stages[0]?.ended;
    expect(actual).toEqual(expected);
  });

  it('does not run the stage after it', async () => {
    const after = new FakeTool('Report');
    const stages = [stage(new FakeTool('Find', { throws: new Error('exploded') }), '|'), stage(after)];

    await run(stages, options());

    const expected = false;
    const actual = after.ran;
    expect(actual).toBe(expected);
  });
});

describe('a stage that was refused', () => {
  it('never runs', async () => {
    const tool = new FakeTool('Delete');
    const refuser = new FakeApprover({ Delete: { verdict: 'refuse' } });

    await run([stage(tool)], options({ approver: refuser }));

    const expected = false;
    const actual = tool.ran;
    expect(actual).toBe(expected);
  });

  it('is reported as refused', async () => {
    const refuser = new FakeApprover({ Delete: { verdict: 'refuse', reason: 'not allowed here' } });

    const { stages } = await run([stage(new FakeTool('Delete'))], options({ approver: refuser }));

    const expected = { kind: 'refused', reason: 'not allowed here' };
    const actual = stages[0]?.ended;
    expect(actual).toEqual(expected);
  });

  it('stops the stage piped from it from running', async () => {
    const after = new FakeTool('Report');
    const refuser = new FakeApprover({ Delete: { verdict: 'refuse' } });

    await run([stage(new FakeTool('Delete'), '|'), stage(after)], options({ approver: refuser }));

    const expected = false;
    const actual = after.ran;
    expect(actual).toBe(expected);
  });
});

describe('a stage after one that failed', () => {
  it('does not run when joined by a pipe', async () => {
    const after = new FakeTool('Report');
    const failing = new FakeTool('Find', { ends: { kind: 'failed', code: 1 } });

    await run([stage(failing, '|'), stage(after)], options());

    const expected = false;
    const actual = after.ran;
    expect(actual).toBe(expected);
  });

  it('is reported as never started', async () => {
    const failing = new FakeTool('Find', { ends: { kind: 'failed', code: 1 } });

    const { stages } = await run([stage(failing, '|'), stage(new FakeTool('Report'))], options());

    const expected = { kind: 'skipped' };
    const actual = stages[1]?.ended;
    expect(actual).toEqual(expected);
  });
});

describe('joining stages', () => {
  it('runs the next stage after a success when joined by &&', async () => {
    const after = new FakeTool('Report');

    await run([stage(new FakeTool('Find', { writes: ['a\n'] }), '&&'), stage(after)], options());

    const expected = true;
    const actual = after.ran;
    expect(actual).toBe(expected);
  });

  it('does not run it after a failure when joined by &&', async () => {
    const after = new FakeTool('Report');
    const failing = new FakeTool('Find', { ends: { kind: 'failed', code: 1 } });

    await run([stage(failing, '&&'), stage(after)], options());

    const expected = false;
    const actual = after.ran;
    expect(actual).toBe(expected);
  });

  it('runs the next stage after a failure when joined by ||', async () => {
    const after = new FakeTool('Fallback');
    const failing = new FakeTool('Find', { ends: { kind: 'failed', code: 1 } });

    await run([stage(failing, '||'), stage(after)], options());

    const expected = true;
    const actual = after.ran;
    expect(actual).toBe(expected);
  });

  it('does not run it after a success when joined by ||', async () => {
    const after = new FakeTool('Fallback');

    await run([stage(new FakeTool('Find', { writes: ['a\n'] }), '||'), stage(after)], options());

    const expected = false;
    const actual = after.ran;
    expect(actual).toBe(expected);
  });

  it('runs the next stage whatever happened when they are merely sequential', async () => {
    const after = new FakeTool('Report');
    const failing = new FakeTool('Find', { ends: { kind: 'failed', code: 1 } });

    await run([stage(failing), stage(after)], options());

    const expected = true;
    const actual = after.ran;
    expect(actual).toBe(expected);
  });

  it('counts a refusal as a failure, so a fallback runs', async () => {
    const after = new FakeTool('Fallback');
    const refuser = new FakeApprover({ Delete: { verdict: 'refuse' } });

    await run([stage(new FakeTool('Delete'), '||'), stage(after)], options({ approver: refuser }));

    const expected = true;
    const actual = after.ran;
    expect(actual).toBe(expected);
  });
});

describe('bytes between stages', () => {
  it('gives the next stage what the previous one wrote', async () => {
    const consumer = new FakeTool('Match', { echoes: true });

    const { output } = await run([stage(new FakeTool('Find', { writes: ['a.ts\n', 'b.ts\n'] }), '|'), stage(consumer)], options());

    const expected = 'a.ts\nb.ts\n';
    const actual = output.toString('utf8');
    expect(actual).toBe(expected);
  });

  it('passes bytes that are not text through unchanged', async () => {
    const bytes = '\u0000\u00ff\u0080(';
    const consumer = new FakeTool('Match', { echoes: true });

    const { output } = await run([stage(new FakeTool('Find', { writes: [bytes] }), '|'), stage(consumer)], options());

    const expected = Buffer.from(bytes, 'binary').toString('hex');
    const actual = Buffer.from(output.toString('binary'), 'binary').toString('hex');
    expect(actual).toBe(expected);
  });

  it('assumes nothing about separators', async () => {
    const consumer = new FakeTool('Match', { echoes: true });

    const { output } = await run([stage(new FakeTool('Find', { writes: ['no separator at all'] }), '|'), stage(consumer)], options());

    const expected = 'no separator at all';
    const actual = output.toString('utf8');
    expect(actual).toBe(expected);
  });
});

describe('a stage whose reader stops', () => {
  it('is told to stop', async () => {
    const producer = new FakeTool('Find', { endless: true });
    const consumer = new FakeTool('Head', { writes: ['one\n'] });

    await run([stage(producer, '|'), stage(consumer)], options({ ahead: 64 }));

    const expected = true;
    const actual = producer.stopped;
    expect(actual).toBe(expected);
  });

  it('stops a producer two stages back', async () => {
    const producer = new FakeTool('Find', { endless: true });
    const middle = new FakeTool('Cat', { echoes: true });
    const consumer = new FakeTool('Head', { writes: ['one\n'] });

    await run([stage(producer, '|'), stage(middle, '|'), stage(consumer)], options({ ahead: 64 }));

    const expected = true;
    const actual = producer.stopped;
    expect(actual).toBe(expected);
  });
});

describe('a run that holds more than it may', () => {
  it('stops the producer', async () => {
    const producer = new FakeTool('Find', { endless: true });

    const { stages } = await run([stage(producer)], options({ hold: 128 }));

    const expected = true;
    const actual = producer.stopped;
    expect(actual).toBe(expected);
  });

  it('says the output is only the start of what there was', async () => {
    const producer = new FakeTool('Find', { endless: true });

    const { stages } = await run([stage(producer)], options({ hold: 128 }));

    const expected = 'truncated';
    const actual = stages[0]?.ended.kind;
    expect(actual).toBe(expected);
  });
});

describe('a run that takes too long', () => {
  it('stops the stage that was running', async () => {
    const clock = new FakeSleep();
    const producer = new FakeTool('Find', { endless: true });

    const running = run([stage(producer)], { ...options({ sleep: clock }), timeout: 5000 });
    clock.elapse();
    await running;

    const expected = true;
    const actual = producer.stopped;
    expect(actual).toBe(expected);
  });

  it('reports it as having timed out', async () => {
    const clock = new FakeSleep();
    const producer = new FakeTool('Find', { endless: true });

    const running = run([stage(producer)], { ...options({ sleep: clock }), timeout: 5000 });
    clock.elapse();
    const { stages } = await running;

    const expected = 'timedOut';
    const actual = stages[0]?.ended.kind;
    expect(actual).toBe(expected);
  });
});

describe('what is judged', () => {
  it('puts every stage to the decision, including one that touches nothing', async () => {
    const asked = new FakeApprover();

    await run([stage(new FakeTool('Find', { writes: ['a\n'] }), '|'), stage(new FakeTool('Match', { echoes: true }))], options({ approver: asked }));

    const expected = ['Find', 'Match'];
    const actual = asked.names();
    expect(actual).toEqual(expected);
  });

  it('shows what a stage would act on when the decision asks to see it', async () => {
    const looker = new FakeApprover();

    await run([stage(new FakeTool('Find', { writes: ['a.ts\nb.ts\n'] }), '|'), stage(new FakeTool('Delete', { echoes: true }))], { ...options(), decide: looker.look });

    const expected = ['a.ts\nb.ts\n'];
    const actual = looker.shown.slice(1).map((shown) => (shown as Buffer).toString('utf8'));
    expect(actual).toEqual(expected);
  });

  it('refuses rather than showing part of what a stage would act on', async () => {
    const looker = new FakeApprover();
    const producer = new FakeTool('Find', { endless: true });

    const { stages } = await run([stage(producer, '|'), stage(new FakeTool('Delete', { echoes: true }))], { ...options({ hold: 128 }), decide: looker.look });

    const expected = 'refused';
    const actual = stages[1]?.ended.kind;
    expect(actual).toBe(expected);
  });
});
