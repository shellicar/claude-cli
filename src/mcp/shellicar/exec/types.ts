import type { InferShape } from '@anthropic-ai/claude-agent-sdk';
import type { z } from 'zod';
import type { CommandSchema, ExecuteResultSchema, PipelineSchema, RedirectSchema, ShellicarExecInputSchema, ShellicarExecOutputSchema, SingleCommandSchema, StepResultSchema, StepSchema } from './schema';

export type StepResult = z.infer<typeof StepResultSchema>;
export type ExecuteResult = z.infer<typeof ExecuteResultSchema>;
export type ExecutionResult = z.infer<typeof ShellicarExecOutputSchema>;

export type ShellicarExecOutput = z.output<typeof ShellicarExecInputSchema>;

export interface ValidationRule {
  /** Rule name for error messages */
  name: string;
  /** Return error message if blocked, undefined if allowed */
  check: (step: Step) => string | undefined;
}

export type Redirect = z.infer<typeof RedirectSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type Pipeline = z.infer<typeof PipelineSchema>;
export type SingleCommand = z.infer<typeof SingleCommandSchema>;
export type Step = z.infer<typeof StepSchema>;

export type ExecToolArgs = InferShape<typeof ShellicarExecInputSchema.shape>;
