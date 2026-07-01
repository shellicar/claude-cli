import { regexSchema } from './regexSchema';

export const regexPattern = (purpose: string, examples: string[]) => regexSchema.describe(`${purpose}. JavaScript (ECMAScript) syntax, as passed to new RegExp() — not PCRE/Python.`).meta({ examples }); // examples as structured JSON-schema examples, not jammed into the text
