import { execCommand } from './execCommand';
import { execPipeline } from './execPipeline';
import type { Step, StepResult } from './types';

/** Execute a single step: one command runs directly, two or more form a pipeline. */
export async function execStep(step: Step, cwd: string, timeoutMs?: number): Promise<StepResult> {
  const [first, second, ...rest] = step.commands;
  if (second == null) {
    return execCommand(first, cwd, timeoutMs);
  }
  return execPipeline([first, second, ...rest], cwd, timeoutMs);
}
