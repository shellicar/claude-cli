import { z } from "zod"

const ReplaceOperation = z.object({
  action: z.literal("replace"),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  content: z.string(),
})

const DeleteOperation = z.object({
  action: z.literal("delete"),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
})

const InsertOperation = z.object({
  action: z.literal("insert"),
  after_line: z.number().int().min(0),
  content: z.string(),
})

export const EditOperation = z.discriminatedUnion("action", [
  ReplaceOperation,
  DeleteOperation,
  InsertOperation,
])

export const EditInput = z.object({
  file: z.string(),
  edits: z.array(EditOperation).min(1),
})

export const EditOutput = z.object({
  patchId: z.string(),
  diff: z.string(),
})

export const EditConfirmInput = z.object({
  patchId: z.string(),
})

export const EditConfirmOutput = z.object({
  linesChanged: z.number().int().nonnegative(),
})
