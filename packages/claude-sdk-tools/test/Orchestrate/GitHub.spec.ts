import { lines as toLines } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createGhPrToolsV2 } from '../../src/Orchestrate/tools/GitHub.js';
import { FakeExecutor } from '../FakeExecutor.js';

async function drain(stream: AsyncIterable<unknown>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of toLines(stream)) {
    out.push(String(value));
  }
  return out;
}

describe('GitHub V2', () => {
  it('is registered as escalate — always gated, never a pre-trustable fs.* tier', () => {
    const [Create] = createGhPrToolsV2({ executor: new FakeExecutor(), getHolderToken: () => 'token' });

    expect(Create.operation).toBe('escalate');
  });

  it('runs the Create tool subcommand with the built args and the holder token env', async () => {
    const executor = new FakeExecutor(() => ({ stdout: 'https://github.com/x/y/pull/1\n', exitCode: 0 }));
    const [Create] = createGhPrToolsV2({ executor, getHolderToken: () => 'holder-token' });

    const result = Create.run({ title: 'Fix it', body: 'Body', base: 'main', cwd: '/repo' }, undefined, []);
    const lines = await drain(result.stdout);

    expect(executor.calls[0]).toEqual({ program: 'gh', args: ['pr', 'create', '--title', 'Fix it', '--body', 'Body', '--base', 'main', '--draft'], cwd: '/repo', env: expect.objectContaining({ GH_TOKEN: 'holder-token' }) });
    expect(lines).toEqual(['https://github.com/x/y/pull/1']);
    expect(result.success()).toBe(true);
  });

  it('reports failure when gh exits non-zero', async () => {
    const executor = new FakeExecutor(() => ({ stderr: 'not found', exitCode: 1 }));
    const [Create] = createGhPrToolsV2({ executor, getHolderToken: () => 'token' });

    const stderr: string[] = [];
    const result = Create.run({ title: 'x', body: 'y', base: 'main' }, undefined, stderr);
    await drain(result.stdout);

    expect(result.success()).toBe(false);
    expect(stderr).toEqual(['not found']);
  });
});
