import { describe, expect, it } from 'vitest';
import { type BufferPolicy, execute } from '../src/execute.js';
import type { Stage, ToolStage } from '../src/types.js';
import { countedSourceTool, endlessSourceTool, pausingConsumerTool, sideEffectTool, takeTool } from './fakeTools.js';

// Four-byte values against a twenty-byte buffer: five fit, and the sixth is where a producer has
// to wait. Small enough that the arithmetic is the assertion rather than a guess.
const VALUE = 'abcd';
const BUFFER: BufferPolicy = { streamBytes: 20, gateBytes: 20 };
const FITS = BUFFER.streamBytes / VALUE.length;

function toolStage(tool: ToolStage['tool'], opts?: Partial<Pick<ToolStage, 'op' | 'input'>>): ToolStage {
  return { kind: 'tool', tool, input: opts?.input ?? {}, op: opts?.op };
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

    const running = execute(stages, { grant: { tiers: new Set() }, buffer: BUFFER });
    await settle();
    const producedWhileHeld = produced.length;
    release();
    await running.catch(() => undefined);

    const expected = true;
    const actual = producedWhileHeld <= FITS + 1;
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

    const running = execute(stages, { grant: { tiers: new Set() }, buffer: BUFFER });
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

    const running = execute(stages, { grant: { tiers: new Set() }, buffer: BUFFER });
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

    await execute(stages, { grant: { tiers: new Set() }, buffer: BUFFER });

    const expected = true;
    const actual = performed.length <= FITS + 2;
    expect(actual).toBe(expected);
  });

  it('does nothing further once its reader has gone', async () => {
    const performed: string[] = [];
    const targets = Array.from({ length: 100 }, (_, index) => `file${index}`);
    const stages: Stage[] = [toolStage(sideEffectTool('Delete', 'none', targets, performed), { op: '|' }), toolStage(takeTool('head', 1), {})];

    await execute(stages, { grant: { tiers: new Set() }, buffer: BUFFER });
    const atStop = performed.length;
    await settle();

    const expected = atStop;
    const actual = performed.length;
    expect(actual).toBe(expected);
  });
});

// A gated stage cannot wait: nothing reads it until its approval is asked, and the approval needs
// the whole batch. So the bound stops it rather than presenting half of what it would do.
describe('a stage waiting on approval', () => {
  it('is asked about the whole batch when it fits', async () => {
    const asked: unknown[][] = [];
    const stages: Stage[] = [toolStage(countedSourceTool('producer', ['a', 'b'], []), { op: '|' }), toolStage(sideEffectTool('Delete', 'fs.delete', ['x'], []), {})];

    await execute(stages, {
      grant: { tiers: new Set() },
      buffer: BUFFER,
      approve: async (ctx) => {
        asked.push(ctx.batch);
        return { approved: true };
      },
    });

    const expected = [['a', 'b']];
    const actual = asked;
    expect(actual).toEqual(expected);
  });

  it('is never asked about a batch the bound cut short', async () => {
    const asked: unknown[][] = [];
    const produced: string[] = [];
    const stages: Stage[] = [toolStage(endlessSourceTool('producer', produced, VALUE), { op: '|' }), toolStage(sideEffectTool('Delete', 'fs.delete', ['x'], []), {})];

    await execute(stages, {
      grant: { tiers: new Set() },
      buffer: BUFFER,
      approve: async (ctx) => {
        asked.push(ctx.batch);
        return { approved: true };
      },
    }).catch(() => undefined);

    const expected = 0;
    const actual = asked.length;
    expect(actual).toBe(expected);
  });

  it('reports the stage that outgrew what could be shown', async () => {
    const stages: Stage[] = [toolStage(endlessSourceTool('producer', [], VALUE), { op: '|' }), toolStage(sideEffectTool('Delete', 'fs.delete', ['x'], []), {})];

    const { reports } = await execute(stages, { grant: { tiers: new Set() }, buffer: BUFFER });

    const expected = false;
    const actual = reports[0]?.success;
    expect(actual).toBe(expected);
  });
});

describe('what the buffer counts', () => {
  it('measures a value in bytes, so multi-byte characters fill it sooner than their length suggests', async () => {
    const produced: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // One character, three bytes: a third of the values fit compared with a single-byte character.
    const stages: Stage[] = [toolStage(endlessSourceTool('producer', produced, '—'), { op: '|' }), toolStage(pausingConsumerTool('consumer', held, []), {})];

    const running = execute(stages, { grant: { tiers: new Set() }, buffer: BUFFER });
    await settle();
    const producedWhileHeld = produced.length;
    release();
    await running.catch(() => undefined);

    const expected = true;
    // Seven three-byte characters reach the bound, and one more may already have left the stage.
    const actual = producedWhileHeld <= Math.ceil(BUFFER.streamBytes / 3) + 1;
    expect(actual).toBe(expected);
  });
});
