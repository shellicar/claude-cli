import { describe, expect, it } from 'vitest';
import { type BufferPolicy, execute } from '../src/execute.js';
import type { Stage, ToolStage } from '../src/types.js';
import { countedSourceTool, endlessSourceTool, pausingConsumerTool, sideEffectTool, takeAllTool, takeTool } from './fakeTools.js';

// Four-byte values against a twenty-byte buffer: five fit, and the sixth is where a producer has
// to wait. Small enough that the arithmetic is the assertion rather than a guess.
const VALUE = 'abcd';
const BUFFER: BufferPolicy = { streamValues: 5, gateValues: 5, resultValues: 10_000 };
const FITS = BUFFER.streamValues;

function toolStage(tool: ToolStage['tool'], opts?: Partial<Pick<ToolStage, 'op' | 'input' | 'captureAs'>>): ToolStage {
  return { kind: 'tool', tool, input: opts?.input ?? {}, op: opts?.op, captureAs: opts?.captureAs };
}

/** Lets everything already scheduled run, so a producer left to itself gets as far as it can. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('how far a stage may run ahead', () => {
  it('stops a producer once the buffer is full', async () => {
    const produced: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stages: Stage[] = [toolStage(endlessSourceTool('producer', produced, VALUE), { op: '|' }), toolStage(pausingConsumerTool('consumer', held, []), {})];

    const running = execute(stages, { buffer: BUFFER });
    await settle();
    const producedWhileHeld = produced.length;
    release();
    await running.catch(() => undefined);

    const expected = true;
    const actual = producedWhileHeld <= FITS + 3;
    expect(actual).toBe(expected);
  });

  it('lets the producer go on once its reader takes something', async () => {
    const produced: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stages: Stage[] = [
      toolStage(
        countedSourceTool(
          'producer',
          Array.from({ length: 100 }, () => VALUE),
          produced,
        ),
        { op: '|' },
      ),
      toolStage(pausingConsumerTool('consumer', held, []), {}),
    ];

    const running = execute(stages, { buffer: BUFFER });
    await settle();
    const beforeReading = produced.length;
    release();
    await running;

    const expected = true;
    const actual = produced.length > beforeReading;
    expect(actual).toBe(expected);
  });

  it('holds nothing beyond the buffer however long nobody reads', async () => {
    const produced: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stages: Stage[] = [toolStage(endlessSourceTool('producer', produced, VALUE), { op: '|' }), toolStage(pausingConsumerTool('consumer', held, []), {})];

    const running = execute(stages, { buffer: BUFFER });
    await settle();
    const first = produced.length;
    await settle();
    const second = produced.length;
    release();
    await running.catch(() => undefined);

    const expected = first;
    const actual = second;
    expect(actual).toBe(expected);
  });
});

// The reason any of this matters: a stage whose values are things it did, not things it found.
describe('a stage whose values are side effects', () => {
  it('does no more than a buffer ahead of what was asked for', async () => {
    const performed: string[] = [];
    const targets = Array.from({ length: 100 }, (_, index) => `file${index}`);
    const stages: Stage[] = [toolStage(sideEffectTool('Delete', 'none', targets, performed), { op: '|' }), toolStage(takeTool('head', 1), {})];

    await execute(stages, { buffer: BUFFER });

    const expected = true;
    const actual = performed.length <= FITS + 3;
    expect(actual).toBe(expected);
  });

  it('does nothing further once its reader has gone', async () => {
    const performed: string[] = [];
    const targets = Array.from({ length: 100 }, (_, index) => `file${index}`);
    const stages: Stage[] = [toolStage(sideEffectTool('Delete', 'none', targets, performed), { op: '|' }), toolStage(takeTool('head', 1), {})];

    await execute(stages, { buffer: BUFFER });
    const atStop = performed.length;
    await settle();

    const expected = atStop;
    const actual = performed.length;
    expect(actual).toBe(expected);
  });
});

// A decision that has to be shown needs the whole batch, so the bound refuses rather than handing
// over half of what a stage would act on.
describe('a stage whose decision asks to see what is piped in', () => {
  it('is shown the whole batch when it fits', async () => {
    const asked: unknown[][] = [];
    const stages: Stage[] = [toolStage(countedSourceTool('producer', ['a', 'b'], []), { op: '|' }), toolStage(sideEffectTool('Delete', 'fs.delete', ['x'], []), {})];

    await execute(stages, {
      buffer: BUFFER,
      approve: async (ctx) => {
        if (ctx.name === 'Delete') {
          asked.push(await ctx.batch());
        }
        return { approved: true };
      },
    });

    const expected = [['a', 'b']];
    const actual = asked;
    expect(actual).toEqual(expected);
  });

  it('is shown nothing at all when the batch outgrows what can be held', async () => {
    const asked: unknown[][] = [];
    const produced: string[] = [];
    const stages: Stage[] = [toolStage(endlessSourceTool('producer', produced, VALUE), { op: '|' }), toolStage(sideEffectTool('Delete', 'fs.delete', ['x'], []), {})];

    await execute(stages, {
      buffer: BUFFER,
      approve: async (ctx) => {
        if (ctx.name === 'Delete') {
          asked.push(await ctx.batch());
        }
        return { approved: true };
      },
    }).catch(() => undefined);

    const expected = 0;
    const actual = asked.length;
    expect(actual).toBe(expected);
  });

  it('reports the stage that outgrew what could be shown', async () => {
    const stages: Stage[] = [toolStage(endlessSourceTool('producer', [], VALUE), { op: '|' }), toolStage(sideEffectTool('Delete', 'fs.delete', ['x'], []), {})];

    const { reports } = await execute(stages, {
      buffer: BUFFER,
      approve: async (ctx) => {
        if (ctx.name === 'Delete') {
          await ctx.batch();
        }
        return { approved: true };
      },
    });

    const expected = false;
    const actual = reports[0]?.success;
    expect(actual).toBe(expected);
  });
});

describe('what the buffer counts', () => {
  it('counts values, so what a value contains does not change how many fit', async () => {
    const produced: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // A long value and a short one occupy a slot each: holding a value is what costs, not the
    // characters inside it.
    const stages: Stage[] = [toolStage(endlessSourceTool('producer', produced, 'a'.repeat(500)), { op: '|' }), toolStage(pausingConsumerTool('consumer', held, []), {})];

    const running = execute(stages, { buffer: BUFFER });
    await settle();
    const producedWhileHeld = produced.length;
    release();
    await running.catch(() => undefined);

    const expected = true;
    const actual = producedWhileHeld <= FITS + 3;
    expect(actual).toBe(expected);
  });
});

// The reason a stage never ran has to reach the caller whichever way its input arrived. When the
// stage before it was drained rather than streamed, there is no producer's report to hang the
// explanation on, and it used to be lost.
describe('a stage skipped for outgrowing the gate, fed by a stage that was not streamed', () => {
  it('says why on its own line', async () => {
    // A capture makes the stage before it run to completion, so it is settled by the time the gate
    // is reached and has no open report left to carry the explanation.
    const stages: Stage[] = [toolStage(endlessSourceTool('producer', [], VALUE), { op: '|', captureAs: 'ALL' }), toolStage(sideEffectTool('Delete', 'fs.delete', ['x'], []), {})];

    const { reports } = await execute(stages, {
      buffer: BUFFER,
      vars: { set: () => undefined },
      approve: async (ctx) => {
        if (ctx.name === 'Delete') {
          await ctx.batch();
        }
        return { approved: true };
      },
    });

    const expected = true;
    const actual = (reports[1]?.message ?? '').length > 0;
    expect(actual).toBe(expected);
  });
});

// The drain that collects the result is the one reader that never gives up, so a producer with no
// end has nothing to stop it. `Program { yes }` as a last stage ran until the process died.
describe('the last stage of all', () => {
  it('is stopped once it has produced more than can be returned', async () => {
    const produced: string[] = [];
    const stages: Stage[] = [toolStage(endlessSourceTool('yes', produced, VALUE), {})];

    await execute(stages, { buffer: { ...BUFFER, resultValues: 10 } });

    const expected = true;
    const actual = produced.length <= 12;
    expect(actual).toBe(expected);
  });

  it('returns what it did produce', async () => {
    const stages: Stage[] = [toolStage(endlessSourceTool('yes', [], VALUE), {})];

    const { result } = await execute(stages, { buffer: { ...BUFFER, resultValues: 10 } });

    const expected = 10;
    const actual = result.length;
    expect(actual).toBe(expected);
  });

  it('says that what came back is only the start of it', async () => {
    const stages: Stage[] = [toolStage(endlessSourceTool('yes', [], VALUE), {})];

    const { reports } = await execute(stages, { buffer: { ...BUFFER, resultValues: 10 } });

    const expected = true;
    const actual = (reports[0]?.message ?? '').includes('start of its output');
    expect(actual).toBe(expected);
  });

  it('stops a producer that never ends, rather than collecting until the process dies', async () => {
    const produced: string[] = [];
    const stages: Stage[] = [toolStage(endlessSourceTool('yes', produced, VALUE), { op: '|' }), toolStage(takeAllTool('collect'), {})];

    await execute(stages, { buffer: { ...BUFFER, resultValues: 10 } });

    const expected = true;
    const actual = produced.length < 100;
    expect(actual).toBe(expected);
  });
});
