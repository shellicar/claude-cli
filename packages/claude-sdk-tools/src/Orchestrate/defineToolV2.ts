import type { Tool } from '@shellicar/orchestrate-core';
import type { z } from 'zod';

/** A tool, and what the model has to be told about it. The engine needs none of the latter: it runs
 *  a tool, it never describes one. */
export type ToolV2Definition = Tool & {
  description: string;
  /** The tool's own shape, and the only one. The wire entry the model is given and the parse of a
   *  stage's input are both built from this, never from a second hand-kept copy. */
  model: z.ZodType;
};

/** Every tool is written through this, so the contract is checked where the tool is defined rather
 *  than wherever something first tries to use it. An annotation on each factory would check exactly
 *  the same thing, but a missing annotation looks like nothing at all, whereas a tool that does not
 *  call this stands out against every other one. */
export const defineToolV2 = (definition: ToolV2Definition): ToolV2Definition => definition;
