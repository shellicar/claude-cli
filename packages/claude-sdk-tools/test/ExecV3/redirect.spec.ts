import { describe, expect, it } from 'vitest';
import { StaticRulesConfigProvider } from '../../src/Exec/IRulesConfigProvider';
import { createExecV3 } from '../../src/ExecV3/ExecV3';
import { passthroughEnvProvider } from '../../src/entry/ExecV3';
import { FakeExecutor, shellLikeResponder } from '../FakeExecutor';
import { MemoryFileSystem } from '../MemoryFileSystem';

// The claim worth pinning is not that the call fails, but that the command never ran. A command
// whose output has nowhere to go must not have had its side effects before anyone was told: that
// is the difference between a caller who can retry and one who has already changed something.
// No real filesystem and no real process — the fake refuses the open, the fake executor records
// whether it was ever asked to run anything.

const refused = '/refused/out.log';

function toolRefusing(target: string) {
  const fs = new MemoryFileSystem();
  fs.refuseOpen(target);
  const executor = new FakeExecutor(shellLikeResponder());
  return { tool: createExecV3(fs, executor, passthroughEnvProvider, new StaticRulesConfigProvider()), executor };
}

const input = { intent: 'redirect stdout to a target that cannot be opened', commands: [{ program: 'echo', args: ['gone'], redirect: { stdout: refused } }] };

describe('a redirect target that cannot be opened', () => {
  it('never runs the command', async () => {
    const { tool, executor } = toolRefusing(refused);

    await tool.handler(tool.input_schema.parse(input));

    const expected = 0;
    const actual = executor.calls.length;
    expect(actual).toBe(expected);
  });

  it('does not report success', async () => {
    const { tool } = toolRefusing(refused);

    const { textContent } = await tool.handler(tool.input_schema.parse(input));

    const expected = false;
    const actual = textContent.success;
    expect(actual).toBe(expected);
  });

  it('names the target that could not be opened', async () => {
    const { tool } = toolRefusing(refused);

    const { textContent } = await tool.handler(tool.input_schema.parse(input));

    const expected = true;
    const actual = textContent.results[0]?.stderr.includes(refused) ?? false;
    expect(actual).toBe(expected);
  });
});

describe('a pipeline where one stage cannot open its redirect', () => {
  const piped = {
    intent: 'pipe into a stage whose stderr redirect cannot be opened',
    commands: [
      { program: 'echo', args: ['a'], op: '|' as const },
      { program: 'cat', redirect: { stderr: refused } },
    ],
  };

  it('runs no stage of that pipeline', async () => {
    const { tool, executor } = toolRefusing(refused);

    await tool.handler(tool.input_schema.parse(piped));

    const expected = 0;
    const actual = executor.calls.length;
    expect(actual).toBe(expected);
  });

  it('tells the other stage it never started', async () => {
    const { tool } = toolRefusing(refused);

    const { textContent } = await tool.handler(tool.input_schema.parse(piped));

    const expected = true;
    const actual = textContent.results[0]?.stderr.includes('not started') ?? false;
    expect(actual).toBe(expected);
  });
});
