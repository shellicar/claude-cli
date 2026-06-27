import { z } from 'zod';

const description = z.string().describe('What this call is doing, in plain words, so the Supreme Commander can see an action he has chosen not to gate. Shown on screen, never stored, never searched.');

export const MemoryTypeSchema = z.object({ type: z.string(), count: z.number().int() });

export const MemoryEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  type: z.string(),
  keywords: z.array(z.string()),
  environment: z.record(z.string(), z.string()),
  createdAt: z.string(),
});

export const MemoryHitSchema = MemoryEntrySchema.extend({ score: z.number() });

export const WriteMemoryInputSchema = z
  .object({
    title: z.string().min(1).describe('The one-line handle that ranks highest and is what a later search recalls. Make it a claim, not a topic.'),
    body: z.string().min(1).describe('The memory itself — what the next Claude needs to know.'),
    type: z.string().min(1).describe('The kind of memory (e.g. trap, decision, pattern). Reuse an existing word from MemoryTypes rather than coining a near-duplicate.'),
    keywords: z.array(z.string()).optional().default([]).describe('Extra search terms that need not appear in the prose.'),
    description,
  })
  .strict();

export const ReadMemoryInputSchema = z.object({ id: z.string().describe('The id returned by WriteMemory or SearchMemory.'), description }).strict();

export const SearchMemoryInputSchema = z
  .object({
    query: z.string().describe('Describe what you need in plain words. Treated only as search terms — never query syntax.'),
    type: z.string().optional().describe('Narrow to one type. Omit to search every type.'),
    limit: z.number().int().positive().max(50).optional().default(10).describe('Maximum hits to return, best first.'),
    description,
  })
  .strict();

export const DeleteMemoryInputSchema = z.object({ id: z.string().describe('The id to retire.'), description }).strict();

export const MemoryTypesInputSchema = z.object({}).strict();

export const WriteMemoryOutputSchema = MemoryEntrySchema;
export const ReadMemoryOutputSchema = z.discriminatedUnion('found', [z.object({ found: z.literal(true), memory: MemoryEntrySchema }), z.object({ found: z.literal(false), id: z.string() })]);
export const SearchMemoryOutputSchema = z.object({ count: z.number().int(), results: z.array(MemoryHitSchema) });
export const DeleteMemoryOutputSchema = z.object({ deleted: z.literal(true), id: z.string() });
export const MemoryTypesOutputSchema = z.object({ types: z.array(MemoryTypeSchema) });
