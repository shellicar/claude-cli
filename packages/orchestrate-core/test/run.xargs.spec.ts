import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { FakeApprover, FakeSleep, FakeTool, stage } from './fakes.js';
import type { Stage } from '../src/types.js';

// An Xargs stage turns what it read into an argument list, and the run puts that into the next
// stage's declared field. The splitting rule is the tool's; the handing over is the run's.

function options(overrides: { hold?: number } = {}) {
  return { decide: new FakeApprover().decide, sleep: new FakeSleep().sleep, hold: overrides.hold ?? 64 * 1024, ahead: 4096 };
}

const xargs = (parameter: string): Stage => ({ kind: 'xargs', parameter });

describe('an Xargs stage between two others', () => {
  it('puts what it read into the next stage’s declared field', async () => {
    const consumer = new FakeTool('Delete');

    await run([stage(new FakeTool('Find', { writes: ['a.ts\nb.ts\n'] }), '|'), xargs('files'), stage(consumer)], options());

    const expected = ['a.ts', 'b.ts'];
    const actual = (consumer.input as { files: string[] }).files;
    expect(actual).toEqual(expected);
  });

  it('keeps what that field already held, with the new values after it', async () => {
    const consumer = new FakeTool('Delete');

    await run([stage(new FakeTool('Find', { writes: ['b.ts\n'] }), '|'), xargs('files'), stage(consumer, undefined, { files: ['a.ts'] })], options());

    const expected = ['a.ts', 'b.ts'];
    const actual = (consumer.input as { files: string[] }).files;
    expect(actual).toEqual(expected);
  });

  it('leaves the rest of that stage’s input alone', async () => {
    const consumer = new FakeTool('TsDiagnostics');

    await run([stage(new FakeTool('Find', { writes: ['a.ts\n'] }), '|'), xargs('files'), stage(consumer, undefined, { severity: 'all' })], options());

    const expected = 'all';
    const actual = (consumer.input as { severity: string }).severity;
    expect(actual).toBe(expected);
  });

  it('gives the stage nothing to read, because it was read to build the list', async () => {
    const consumer = new FakeTool('Delete', { echoes: true });

    const { output } = await run([stage(new FakeTool('Find', { writes: ['a.ts\n'] }), '|'), xargs('files'), stage(consumer)], options());

    const expected = '';
    const actual = output.toString('utf8');
    expect(actual).toBe(expected);
  });
});

// A command with no arguments is a different command: `find -name nothing | xargs rm` runs `rm`
// with nothing and fails, which is why GNU grew `--no-run-if-empty`.
describe('an Xargs stage that read nothing', () => {
  it('does not run the stage it would have fed', async () => {
    const consumer = new FakeTool('Delete');

    await run([stage(new FakeTool('Find', { writes: [] }), '|'), xargs('files'), stage(consumer)], options());

    const expected = false;
    const actual = consumer.ran;
    expect(actual).toBe(expected);
  });

  it('reports that stage as never started', async () => {
    const { stages } = await run([stage(new FakeTool('Find', { writes: [] }), '|'), xargs('files'), stage(new FakeTool('Delete'))], options());

    const expected = 'skipped';
    const actual = stages[1]?.ended.kind;
    expect(actual).toBe(expected);
  });
});

describe('an Xargs stage reading more than may be held', () => {
  it('stops the stage that was producing', async () => {
    const producer = new FakeTool('Find', { endless: true });

    await run([stage(producer, '|'), xargs('files'), stage(new FakeTool('Delete'))], options({ hold: 128 }));

    const expected = true;
    const actual = producer.stopped;
    expect(actual).toBe(expected);
  });

  it('does not run the stage it would have fed', async () => {
    const consumer = new FakeTool('Delete');

    await run([stage(new FakeTool('Find', { endless: true }), '|'), xargs('files'), stage(consumer)], options({ hold: 128 }));

    const expected = false;
    const actual = consumer.ran;
    expect(actual).toBe(expected);
  });
});
