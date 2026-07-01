import type { z } from 'zod';
import type { CommandResultSchema, CommandSchema, ExecV3InputSchema, ExecV3OutputSchema, RedirectSchema } from './schema';

export type Redirect = z.output<typeof RedirectSchema>;
export type Command = z.output<typeof CommandSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type ExecV3Input = z.output<typeof ExecV3InputSchema>;
export type ExecV3Output = z.infer<typeof ExecV3OutputSchema>;
