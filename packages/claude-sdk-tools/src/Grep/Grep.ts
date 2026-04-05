import { defineTool } from '@shellicar/claude-sdk';
import { collectMatchedIndices } from '../collectMatchedIndices';
import { GrepInputSchema } from './schema';

export const Grep = defineTool({
  name: 'Grep',
  description: 'Filter lines matching a pattern from piped content. Works on output from ReadFile (lines) or Find (file list).',
  operation: 'read',
  input_schema: GrepInputSchema,
  input_examples: [{ pattern: 'export' }, { pattern: 'TODO', caseInsensitive: true }, { pattern: 'error', context: 2 }],
  handler: async (input) => {
    const flags = input.caseInsensitive ? 'i' : '';
    const regex = new RegExp(input.pattern, flags);

    if (input.content == null) {
      return { type: 'content', values: [], totalLines: 0 };
    }

    if (input.content.type === 'files') {
      return {
        type: 'files',
        values: input.content.values.filter((v) => regex.test(v)),
      };
    }

    // PipeContent — filter with optional context
    const values = input.content.values;
    const incomingLineNumbers = input.content.lineNumbers;
    const indices = collectMatchedIndices(values, regex, input.context);
    const filtered = indices.map((i) => values[i]);
    const lineNumbers = indices.map((i) => (incomingLineNumbers != null ? (incomingLineNumbers[i] ?? i + 1) : i + 1));

    return {
      type: 'content',
      values: filtered,
      totalLines: input.content.totalLines,
      path: input.content.path,
      lineNumbers,
    };
  },
});
