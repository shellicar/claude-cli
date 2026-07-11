import { NodeFileSystem } from '@shellicar/claude-sdk-tools/fs';
import { runAuditMigration } from './migrateAudit.js';

// Dry run by default: a bare invocation reports what a real run would do and
// writes nothing. Writing the real ~/.claude/audit requires an explicit --apply.
const apply = process.argv.includes('--apply');

const summary = await runAuditMigration(new NodeFileSystem(), (line) => process.stdout.write(`${line}\n`), apply);
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (!apply) {
  process.stdout.write('Dry run: no files were modified. Re-run with --apply to write the changes above.\n');
}
process.exit(summary.failed > 0 ? 1 : 0);
