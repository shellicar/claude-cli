import { pathSchema } from '@shellicar/claude-sdk';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { positionInputSchema } from '../../typescript/positionInputSchema.js';
import { ITypeScriptService } from '../../typescript/ITypeScriptService.js';
import { defineToolV2, type ToolV2Definition } from '../defineToolV2.js';

const TsDiagnosticsToolV2Model = z.object({
  files: z
    .array(
      z.object({
        file: pathSchema.describe('Path to the TypeScript file to check. Supports absolute or relative paths.'),
        severity: z.enum(['error', 'warning', 'suggestion', 'all']).default('error').describe('Filter diagnostics by severity. Defaults to error.'),
      }),
    )
    .min(1)
    .describe('Files to check, each with its own optional severity filter. One call checks the whole batch on a single tsserver spawn.'),
});

/** Resolves `scope`'s shared `ITypeScriptService` \u2014 present for every V2 tool call in a batch
 *  since `OrchestrateEngine.runBatch` always opens one; the null check exists only for a caller
 *  that reaches a TS tool's `run` outside a batch (e.g. a unit test calling it directly). */
function resolveTypeScriptService(name: string, scope: Parameters<ToolV2Definition<z.ZodType>['run']>[4]) {
  if (scope == null) {
    throw new Error(`${name} requires a batch scope to resolve ITypeScriptService`);
  }
  return scope.resolve(ITypeScriptService);
}

/** V2 equivalents of V1's TsDiagnostics/TsHover/TsReferences/TsDefinition \u2014 same
 *  `ITypeScriptService`, reduced to plain-text `path:line:character: text` lines (the
 *  convention `Read`'s V2 leaf already uses) instead of V1's JSON output, per Orchestrate's
 *  plain-text-stdout design. `fs.read` tier: reading type information is a filesystem read
 *  like any other. All four share one shared tsserver per batch via
 *  `scope.resolve(ITypeScriptService)` \u2014 the same per-batch DI scope
 *  `OrchestrateEngine.runBatch` opens once and passes to every V2 tool call in the round. */
export function createTsToolsV2(): ToolV2Definition<z.ZodType>[] {
  return [
    defineToolV2({
      name: 'TsDiagnostics',
      description: 'Get TypeScript diagnostics (type errors, syntax errors) for one or more files. Returns diagnostics grouped by file path, each entry including line, character, message, and error code.',
      operation: 'fs.read',
      model: TsDiagnosticsToolV2Model,
      run: (input, _upstream, _stderr, _signal, scope): ToolV2Result<string> => {
        async function* run(): Stream<string> {
          const ts = resolveTypeScriptService('TsDiagnostics', scope);
          for (const target of input.files as z.infer<typeof TsDiagnosticsToolV2Model>['files']) {
            const diagnostics = await ts.getDiagnostics({ file: target.file, severity: target.severity });
            for (const d of diagnostics) {
              yield `${d.file}:${d.line}:${d.character}: [${d.severity}] ${d.message} (${d.code})`;
            }
          }
        }
        return { stdout: run(), success: () => true };
      },
    }),
    defineToolV2({
      name: 'TsHover',
      description: 'Get type information and documentation for a symbol at a specific position in a TypeScript file. Returns the type signature, symbol kind, and any JSDoc documentation.',
      operation: 'fs.read',
      model: positionInputSchema,
      run: (input, _upstream, _stderr, _signal, scope): ToolV2Result<string> => {
        let found = false;
        async function* run(): Stream<string> {
          const ts = resolveTypeScriptService('TsHover', scope);
          const info = await ts.getHoverInfo({ file: input.file, line: input.line, character: input.character });
          if (info == null) {
            yield 'No symbol at that position';
            return;
          }
          found = true;
          yield `${info.kind}: ${info.text}`;
          if (info.documentation) {
            yield info.documentation;
          }
        }
        return { stdout: run(), success: () => found };
      },
    }),
    defineToolV2({
      name: 'TsReferences',
      description: 'Find all references to a symbol at a specific position in a TypeScript file. Returns every location where the symbol is used across the project, grouped by file path, including the definition site.',
      operation: 'fs.read',
      model: positionInputSchema,
      run: (input, _upstream, _stderr, _signal, scope): ToolV2Result<string> => {
        async function* run(): Stream<string> {
          const ts = resolveTypeScriptService('TsReferences', scope);
          const references = await ts.getReferences({ file: input.file, line: input.line, character: input.character });
          for (const r of references) {
            yield `${r.file}:${r.line}:${r.character}: ${r.text}`;
          }
        }
        return { stdout: run(), success: () => true };
      },
    }),
    defineToolV2({
      name: 'TsDefinition',
      description: 'Go to the definition of a symbol at a specific position in a TypeScript file. Returns the definition positions grouped by file path. May return multiple locations for overloaded functions or declaration merging.',
      operation: 'fs.read',
      model: positionInputSchema,
      run: (input, _upstream, _stderr, _signal, scope): ToolV2Result<string> => {
        async function* run(): Stream<string> {
          const ts = resolveTypeScriptService('TsDefinition', scope);
          const definitions = await ts.getDefinition({ file: input.file, line: input.line, character: input.character });
          for (const d of definitions) {
            yield `${d.file}:${d.line}:${d.character}`;
          }
        }
        return { stdout: run(), success: () => true };
      },
    }),
  ];
}
