// Prints the JSON-serialized wire format length of each tool's schema definition.
// Useful for gauging whether the tool library is large enough to benefit from
// advanced tool use deferred loading (generally worth it above ~10K total chars).
//
// Run from the repo root:
//   pnpm tsx scripts/src/tool-schema-sizes.ts

import { toWireTool } from '@shellicar/claude-sdk';
import type { ITypeScriptService } from '@shellicar/claude-sdk-tools/TsService';
import { createAppTools } from '../../apps/claude-sdk-cli/src/createAppTools.js';

// Stub — handler is never invoked; only name/description/schema/examples matter.
const stubTs = null as unknown as ITypeScriptService;
const { tools } = createAppTools(stubTs);

const sizes = tools.map((tool) => ({
  name: tool.name,
  chars: JSON.stringify(toWireTool(tool)).length,
}));

sizes.sort((a, b) => b.chars - a.chars);

const total = sizes.reduce((sum, s) => sum + s.chars, 0);
const nameWidth = Math.max(...sizes.map((s) => s.name.length), 'Tool'.length);
const sep = '-'.repeat(nameWidth + 10);

console.log(`${'Tool'.padEnd(nameWidth)}  Chars`);
console.log(sep);
for (const { name, chars } of sizes) {
  console.log(`${name.padEnd(nameWidth)}  ${chars.toLocaleString()}`);
}
console.log(sep);
console.log(`${'Total'.padEnd(nameWidth)}  ${total.toLocaleString()}`);
