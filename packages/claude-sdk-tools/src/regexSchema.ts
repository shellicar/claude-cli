import { z } from 'zod';

/** A string field that must be a valid regular expression. One shared schema, applied to every
 *  regex-pattern field, so a malformed pattern fails the model schema pre-flight (naming the
 *  specific cause) rather than throwing inside a handler. The value stays a string — the handler
 *  builds the RegExp where it uses it. */
export const regexSchema = z.string().min(1).superRefine((val, ctx) => {
  try {
    new RegExp(val);
  } catch (err) {
    ctx.addIssue({ code: 'custom', message: err instanceof Error ? err.message : 'Invalid regular expression' });
  }
});
