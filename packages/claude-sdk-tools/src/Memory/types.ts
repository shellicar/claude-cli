import type { z } from 'zod';
import type { DeleteMemoryInputSchema, DeleteMemoryOutputSchema, MemoryTypesInputSchema, MemoryTypesOutputSchema, ReadMemoryInputSchema, ReadMemoryOutputSchema, SearchMemoryInputSchema, SearchMemoryOutputSchema, WriteMemoryInputSchema, WriteMemoryOutputSchema } from './schema';

export type WriteMemoryInput = z.output<typeof WriteMemoryInputSchema>;
export type ReadMemoryInput = z.output<typeof ReadMemoryInputSchema>;
export type SearchMemoryInput = z.output<typeof SearchMemoryInputSchema>;
export type DeleteMemoryInput = z.output<typeof DeleteMemoryInputSchema>;
export type MemoryTypesInput = z.output<typeof MemoryTypesInputSchema>;
export type WriteMemoryOutput = z.output<typeof WriteMemoryOutputSchema>;
export type ReadMemoryOutput = z.output<typeof ReadMemoryOutputSchema>;
export type SearchMemoryOutput = z.output<typeof SearchMemoryOutputSchema>;
export type DeleteMemoryOutput = z.output<typeof DeleteMemoryOutputSchema>;
export type MemoryTypesOutput = z.output<typeof MemoryTypesOutputSchema>;
