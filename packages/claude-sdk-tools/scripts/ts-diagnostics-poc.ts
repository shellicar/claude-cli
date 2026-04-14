/**
 * POC: Prove ts_diagnostics works end-to-end with a real tsserver.
 *
 * Run from the repo root:
 *   pnpm tsx packages/claude-sdk-tools/scripts/ts-diagnostics-poc.ts
 */

import path from 'node:path';
import { createTsDiagnostics } from '../src/TsDiagnostics/TsDiagnostics';
import { TsServerService } from '../src/typescript/TsServerService';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

async function main() {
  console.log('=== ts_diagnostics POC ===\n');
  console.log(`Project root: ${REPO_ROOT}\n`);

  const tsService = new TsServerService({ cwd: REPO_ROOT });
  const tool = createTsDiagnostics(tsService);

  try {
    await tsService.start();
    console.log('tsserver started.\n');

    // Test 1: Check a file that should compile cleanly
    console.log('--- Test 1: Clean file (expandPath.ts) ---');
    const cleanResult = await tool.handler({
      file: 'packages/claude-sdk-tools/src/expandPath.ts',
      severity: 'all',
    });
    console.log(`File: ${cleanResult.file}`);
    console.log(`Diagnostics: ${cleanResult.count}`);
    if (cleanResult.count === 0) {
      console.log('PASS: No diagnostics on a clean file.\n');
    } else {
      console.log('Diagnostics found:');
      for (const d of cleanResult.diagnostics) {
        console.log(`  L${d.line}:${d.character} [${d.severity}] ${d.message} (TS${d.code})`);
      }
      console.log();
    }

    // Test 2: Check the ITypeScriptService interface itself
    console.log('--- Test 2: ITypeScriptService.ts ---');
    const ifaceResult = await tool.handler({
      file: 'packages/claude-sdk-tools/src/typescript/ITypeScriptService.ts',
      severity: 'all',
    });
    console.log(`File: ${ifaceResult.file}`);
    console.log(`Diagnostics: ${ifaceResult.count}`);
    if (ifaceResult.count === 0) {
      console.log('PASS: Interface file compiles cleanly.\n');
    } else {
      for (const d of ifaceResult.diagnostics) {
        console.log(`  L${d.line}:${d.character} [${d.severity}] ${d.message} (TS${d.code})`);
      }
      console.log();
    }

    // Test 3: Check a file that exists in the repo to see real diagnostics (if any)
    console.log('--- Test 3: TsServerService.ts ---');
    const implResult = await tool.handler({
      file: 'packages/claude-sdk-tools/src/typescript/TsServerService.ts',
      severity: 'all',
    });
    console.log(`File: ${implResult.file}`);
    console.log(`Diagnostics: ${implResult.count}`);
    for (const d of implResult.diagnostics) {
      console.log(`  L${d.line}:${d.character} [${d.severity}] ${d.message} (TS${d.code})`);
    }
    if (implResult.count === 0) {
      console.log('PASS: Implementation file compiles cleanly.');
    }
    console.log();

    console.log('=== POC complete ===');
  } finally {
    tsService.stop();
    console.log('tsserver stopped.');
  }
}

main().catch((err) => {
  console.error('POC failed:', err);
  process.exit(1);
});
