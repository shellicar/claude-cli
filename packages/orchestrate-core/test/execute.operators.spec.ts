import { describe, expect, it } from 'vitest';
import { execute } from '../src/execute.js';
import type { Stage, ToolStage } from '../src/types.js';
import { echoUpstreamTool, recordingTool, sourceTool } from './fakeTools.js';

function toolStage(tool: ToolStage['tool'], op?: ToolStage['op']): ToolStage {
  return { kind: 'tool', tool, input: {}, op };
}

describe('execute — && operator', () => {
  it('runs the next stage when the previous one succeeded', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [toolStage(sourceTool('a', []), '&&'), toolStage(recordingTool('b', 'none', true, calls), undefined)];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = 1;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });

  it('skips the next stage when the previous one failed', async () => {
    const calls: unknown[] = [];
    const failing = recordingTool('a', 'none', false, []);
    const stages: Stage[] = [toolStage(failing, '&&'), toolStage(recordingTool('b', 'none', true, calls), undefined)];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = 0;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });
});

describe('execute — || operator', () => {
  it('runs the fallback stage when the previous one failed', async () => {
    const calls: unknown[] = [];
    const failing = recordingTool('a', 'none', false, []);
    const stages: Stage[] = [toolStage(failing, '||'), toolStage(recordingTool('b', 'none', true, calls), undefined)];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = 1;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });

  it('skips the fallback stage when the previous one succeeded', async () => {
    const calls: unknown[] = [];
    const succeeding = recordingTool('a', 'none', true, []);
    const stages: Stage[] = [toolStage(succeeding, '||'), toolStage(recordingTool('b', 'none', true, calls), undefined)];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = 0;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });
});

describe('execute — sequential join (no op, bash ;)', () => {
  it('does not forward the previous stage stdout as the next stage upstream', async () => {
    const stages: Stage[] = [toolStage(sourceTool('a', ['upstream-data']), undefined), toolStage(echoUpstreamTool('b'), undefined)];

    const { result } = await execute(stages, { grant: { tiers: new Set() } });

    // echoUpstreamTool re-yields whatever upstream it was handed — empty means it got none,
    // which is the actual bug this pins down: an earlier POC pass forwarded stdout regardless.
    const expected: string[] = [];
    const actual = result;
    expect(actual).toEqual(expected);
  });
});

describe('execute — | operator', () => {
  it('pipes the previous stage stdout into the next stage', async () => {
    const stages: Stage[] = [toolStage(sourceTool('a', ['piped-value']), '|'), toolStage(echoUpstreamTool('b'), undefined)];

    const { result } = await execute(stages, { grant: { tiers: new Set() } });

    const expected = ['piped-value'];
    const actual = result;
    expect(actual).toEqual(expected);
  });

  it('pipes across three stages, not just two', async () => {
    const stages: Stage[] = [toolStage(sourceTool('a', ['x']), '|'), toolStage(echoUpstreamTool('b'), '|'), toolStage(echoUpstreamTool('c'), undefined)];

    const { result } = await execute(stages, { grant: { tiers: new Set() } });

    const expected = ['x'];
    const actual = result;
    expect(actual).toEqual(expected);
  });
});

describe('execute — sequential after a short-circuited stage (bash: false && echo b ; echo done)', () => {
  it('the third stage still runs even though the middle one was skipped', async () => {
    const calls: unknown[] = [];
    const failing = recordingTool('a', 'none', false, []);
    const stages: Stage[] = [toolStage(failing, '&&'), toolStage(recordingTool('b', 'none', true, []), undefined), toolStage(recordingTool('c', 'none', true, calls), undefined)];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = 1;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });
});

describe('execute — precedence (bash: false && echo b || echo c)', () => {
  it('runs the || fallback after a preceding && skip, left to right', async () => {
    const calls: unknown[] = [];
    const failing = recordingTool('a', 'none', false, []);
    const stages: Stage[] = [toolStage(failing, '&&'), toolStage(recordingTool('b', 'none', true, []), '||'), toolStage(recordingTool('c', 'none', true, calls), undefined)];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = 1;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });
});

describe('execute — pipe no-pipefail (bash: a failing producer | a succeeding consumer)', () => {
  it('a stage after the pipe still runs via &&, since the pipe overall reflects the last stage, not the first', async () => {
    const calls: unknown[] = [];
    const failingProducer = recordingTool('a', 'none', false, []);
    const stages: Stage[] = [toolStage(failingProducer, '|'), toolStage(sourceTool('b', ['consumed ok']), '&&'), toolStage(recordingTool('c', 'none', true, calls), undefined)];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = 1;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });
});
