import { describe, expect, it } from 'vitest';
import type { BashPlusPlusInput, Step } from './schema.js';
import { execute } from './executor.js';

/** Helper: build a BashPlusPlusInput with defaults */
function input(steps: Step[], chaining: BashPlusPlusInput['chaining'] = 'bail_on_error'): BashPlusPlusInput {
  return {
    description: 'test',
    steps,
    chaining,
    background: false,
  };
}

/** Helper: single command step */
function cmd(program: string, args: string[] = [], extra?: Partial<Step & { type: 'command' }>): Step {
  return { type: 'command', program, args, ...extra };
}

describe('executor', () => {
  describe('single command execution', () => {
    it('executes echo and captures stdout', async () => {
      const result = await execute(input([cmd('echo', ['hello'])]), '/tmp');
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].stdout.trim()).toBe('hello');
      expect(result.results[0].exitCode).toBe(0);
    });

    it('captures stderr', async () => {
      // cat on a nonexistent file writes to stderr and exits non-zero
      const result = await execute(input([cmd('cat', ['/tmp/nonexistent-file-xyz-12345'])]), '/tmp');
      expect(result.success).toBe(false);
      expect(result.results[0].stderr).toBeTruthy();
      expect(result.results[0].exitCode).not.toBe(0);
    });
  });

  describe('command with stdin', () => {
    it('pipes stdin content to the command', async () => {
      const step: Step = {
        type: 'command',
        program: 'cat',
        args: [],
        stdin: 'hello from stdin',
      };
      const result = await execute(input([step]), '/tmp');
      expect(result.success).toBe(true);
      expect(result.results[0].stdout.trim()).toBe('hello from stdin');
    });
  });

  describe('pipeline execution', () => {
    it('pipes stdout of first command to stdin of second', async () => {
      const step: Step = {
        type: 'pipeline',
        commands: [
          { program: 'echo', args: ['hello world'] },
          { program: 'wc', args: ['-w'] },
        ],
      };
      const result = await execute(input([step]), '/tmp');
      expect(result.success).toBe(true);
      expect(result.results[0].stdout.trim()).toBe('2');
    });

    it('supports multi-stage pipelines', async () => {
      const step: Step = {
        type: 'pipeline',
        commands: [
          { program: 'echo', args: ['banana\napple\ncherry'] },
          { program: 'sort' },
          { program: 'head', args: ['-1'] },
        ],
      };
      const result = await execute(input([step]), '/tmp');
      expect(result.success).toBe(true);
      expect(result.results[0].stdout.trim()).toBe('apple');
    });
  });

  describe('bail_on_error chaining', () => {
    it('stops on first failure', async () => {
      const steps: Step[] = [
        cmd('false'),
        cmd('echo', ['should not run']),
      ];
      const result = await execute(input(steps, 'bail_on_error'), '/tmp');
      expect(result.success).toBe(false);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].exitCode).not.toBe(0);
    });

    it('runs all steps when all succeed', async () => {
      const steps: Step[] = [
        cmd('true'),
        cmd('echo', ['ran']),
      ];
      const result = await execute(input(steps, 'bail_on_error'), '/tmp');
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
    });
  });

  describe('sequential chaining', () => {
    it('runs all steps regardless of failure', async () => {
      const steps: Step[] = [
        cmd('false'),
        cmd('echo', ['should run']),
      ];
      const result = await execute(input(steps, 'sequential'), '/tmp');
      // Both steps ran
      expect(result.results).toHaveLength(2);
      // Overall success is false because first step failed
      expect(result.success).toBe(false);
      // But the second step did execute
      expect(result.results[1].stdout.trim()).toBe('should run');
      expect(result.results[1].exitCode).toBe(0);
    });
  });

  describe('command not found', () => {
    it('returns error for nonexistent program', async () => {
      const result = await execute(input([cmd('nonexistent_program_xyz_12345')]), '/tmp');
      expect(result.success).toBe(false);
      expect(result.results[0].exitCode).not.toBe(0);
      expect(result.results[0].stderr).toBeTruthy();
    });
  });

  describe('exit code propagation', () => {
    it('propagates exit code from the command', async () => {
      // bash -c "exit 42" to get a specific exit code
      const result = await execute(input([cmd('bash', ['-c', 'exit 42'])]), '/tmp');
      expect(result.success).toBe(false);
      expect(result.results[0].exitCode).toBe(42);
    });

    it('reports exit code 0 for successful commands', async () => {
      const result = await execute(input([cmd('true')]), '/tmp');
      expect(result.success).toBe(true);
      expect(result.results[0].exitCode).toBe(0);
    });
  });
});
