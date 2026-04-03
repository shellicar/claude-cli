import { ReadFileInputSchema, ReadFileOutputFailureSchea, ReadFileOutputSchema, ReadFileOutputSuccessSchema } from "./schema";
import { z } from "zod";

export type ReadFileInput = z.output<typeof ReadFileInputSchema>;
export type ReadFileOutput = z.input<typeof ReadFileOutputSchema>;
export type ReadFileOutputSuccess = z.input<typeof ReadFileOutputSuccessSchema>;
export type ReadFileOutputFailure = z.input<typeof ReadFileOutputFailureSchea>;
