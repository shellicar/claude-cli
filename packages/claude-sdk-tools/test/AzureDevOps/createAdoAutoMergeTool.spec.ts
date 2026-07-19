import { describe, expect, it } from 'vitest';
import { buildMergeCommitMessage } from '../../src/AzureDevOps/createAdoAutoMergeTool';

describe('buildMergeCommitMessage', () => {
  it('matches the format Azure DevOps\' own web UI generates on completion', () => {
    const expected = 'Merged PR 42: Fix the flaky retry test\n\nRetries now back off exponentially.';
    const actual = buildMergeCommitMessage(42, 'Fix the flaky retry test', 'Retries now back off exponentially.');
    expect(actual).toBe(expected);
  });

  it('leaves the description blank when the pull request has none', () => {
    const expected = 'Merged PR 42: Fix the flaky retry test\n\n';
    const actual = buildMergeCommitMessage(42, 'Fix the flaky retry test', '');
    expect(actual).toBe(expected);
  });
});
