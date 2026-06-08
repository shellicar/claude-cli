import type { z } from 'zod';
import type { CommandResultSchema, CommandSchema, ExecV2InputSchema, ExecV2OutputSchema, OperationSchema, PipelineSchema } from './schema';

export type Command = z.output<typeof CommandSchema>;
export type Operation = z.output<typeof OperationSchema>;
export type Pipeline = z.output<typeof PipelineSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type ExecV2Input = z.output<typeof ExecV2InputSchema>;
export type ExecV2Output = z.infer<typeof ExecV2OutputSchema>;
