import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IExecutor } from '@shellicar/exec-core';
import { execCommand } from './execCommand';
import { execPipeline } from './execPipeline';
import type { Step, StepResult } from './types';

/** Execute a single step: one command runs directly, two or more form a pipeline. */
export async function execStep(step: Step, cwd: string, abortSignal: AbortSignal | undefined, executor: IExecutor, fs: IFileSystem): Promise<StepResult> {
  const [first, second, ...rest] = step.commands;
  if (second == null) {
    return execCommand(first, cwd, abortSignal, executor, fs);
  }
  return execPipeline([first, second, ...rest], cwd, abortSignal, executor, fs);
}
