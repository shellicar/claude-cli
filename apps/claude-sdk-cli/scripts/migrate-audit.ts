import { NodeFileSystem } from '@shellicar/claude-sdk-tools/fs';
import { runAuditMigration } from './migrateAudit.js';

const summary = await runAuditMigration(new NodeFileSystem(), (line) => process.stdout.write(`${line}\n`));
process.stdout.write(`${JSON.stringify(summary)}\n`);
process.exit(summary.failed > 0 ? 1 : 0);
