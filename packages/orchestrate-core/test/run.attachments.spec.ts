import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { FakeApprover, FakeSleep, FakeTool, stage } from './fakes.js';

// A stage can send something back that is not text: a document, an image. It goes to whoever asked
// for the run, never to the stage after it, and it carries the type the tool knows it to be —
// bytes alone cannot say what they are, and guessing at the boundary is how a request gets rejected.

const PDF = Buffer.from('%PDF-1.7\nbody\n%%EOF\n', 'binary');

function options(overrides: { hold?: number } = {}) {
  return { decide: new FakeApprover().decide, sleep: new FakeSleep().sleep, hold: overrides.hold ?? 64 * 1024, ahead: 4096 };
}

describe('what a stage attaches', () => {
  it('comes back against the stage that attached it', async () => {
    const tool = new FakeTool('ReadBinaryFile', { attaches: [{ bytes: PDF, type: 'application/pdf' }] });

    const { stages } = await run([stage(tool)], options());

    const expected = ['application/pdf'];
    const actual = stages[0]?.attached.map((item) => item.type);
    expect(actual).toEqual(expected);
  });

  it('comes back with the bytes it was given', async () => {
    const tool = new FakeTool('ReadBinaryFile', { attaches: [{ bytes: PDF, type: 'application/pdf' }] });

    const { stages } = await run([stage(tool)], options());

    const expected = PDF.toString('hex');
    const actual = stages[0]?.attached[0]?.bytes.toString('hex');
    expect(actual).toBe(expected);
  });

  it('does not reach the stage after it', async () => {
    const attaching = new FakeTool('ReadBinaryFile', { writes: ['a.pdf read\n'], attaches: [{ bytes: PDF, type: 'application/pdf' }] });
    const consumer = new FakeTool('Match', { echoes: true });

    const { output } = await run([stage(attaching, '|'), stage(consumer)], options());

    const expected = 'a.pdf read\n';
    const actual = output.toString('utf8');
    expect(actual).toBe(expected);
  });

  it('is nothing at all for a stage that attached nothing', async () => {
    const { stages } = await run([stage(new FakeTool('Find', { writes: ['a.ts\n'] }))], options());

    const expected: unknown[] = [];
    const actual = stages[0]?.attached;
    expect(actual).toEqual(expected);
  });

  it('is nothing for a stage that never ran', async () => {
    const failing = new FakeTool('Find', { ends: { kind: 'failed', code: 1 } });
    const never = new FakeTool('ReadBinaryFile', { attaches: [{ bytes: PDF, type: 'application/pdf' }] });

    const { stages } = await run([stage(failing, '&&'), stage(never)], options());

    const expected: unknown[] = [];
    const actual = stages[1]?.attached;
    expect(actual).toEqual(expected);
  });

  it('comes back even when the stage failed', async () => {
    const tool = new FakeTool('ReadBinaryFile', { attaches: [{ bytes: PDF, type: 'application/pdf' }], ends: { kind: 'failed', code: 1 } });

    const { stages } = await run([stage(tool)], options());

    const expected = 1;
    const actual = stages[0]?.attached.length;
    expect(actual).toBe(expected);
  });
});

describe('a stage attaching more than may be held', () => {
  it('keeps what fit and no more', async () => {
    const big = { bytes: Buffer.alloc(200), type: 'application/pdf' };
    const tool = new FakeTool('ReadBinaryFile', { attaches: [big, big, big] });

    const { stages } = await run([stage(tool)], options({ hold: 256 }));

    const expected = true;
    const actual = (stages[0]?.attached.length ?? 0) < 3;
    expect(actual).toBe(expected);
  });
});
