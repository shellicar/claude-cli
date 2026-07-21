import { ToolRefusedError } from '@shellicar/claude-sdk';
import type { CommandSpec, ExitStatus, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import { StaticRulesConfigProvider } from '../src/Exec/IRulesConfigProvider';
import { createExecV3 } from '../src/ExecV3/ExecV3';
import { passthroughEnvProvider } from '../src/entry/ExecV3';
import { MemoryFileSystem } from './MemoryFileSystem';

const echoExecutor: IExecutor = {
  run: async (cmd: CommandSpec, opts?: SpawnOpts): Promise<ExitStatus> => {
    opts?.stdout?.end(cmd.program);
    opts?.stderr?.end();
    return { exitCode: 0, signal: null };
  },
};

describe('ExecV3 — configured blocklist', () => {
  it('refuses a configured blocked command', async () => {
    const tool = createExecV3(new MemoryFileSystem(), echoExecutor, passthroughEnvProvider, new StaticRulesConfigProvider({}, [{ program: 'npm', args: ['publish'] }]));
    const input = tool.input_schema.parse({ intent: 'try npm publish', commands: [{ program: 'npm', args: ['publish'] }] });
    await expect(tool.handler(input)).rejects.toBeInstanceOf(ToolRefusedError);
  });

  it('allows a command the configured pattern does not match', async () => {
    const tool = createExecV3(new MemoryFileSystem(), echoExecutor, passthroughEnvProvider, new StaticRulesConfigProvider({}, [{ program: 'npm', args: ['publish'] }]));
    const { textContent } = await tool.handler(tool.input_schema.parse({ intent: 'npm install', commands: [{ program: 'npm', args: ['install'] }] }));
    expect(textContent.success).toBe(true);
  });
});
