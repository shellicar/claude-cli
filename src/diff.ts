import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function formatDiff(filePath: string, oldString: string, newString: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-cli-diff-'));
  const oldFile = join(dir, 'old');
  const newFile = join(dir, 'new');

  try {
    writeFileSync(oldFile, oldString);
    writeFileSync(newFile, newString);

    try {
      // diff exits 1 when files differ, which is the normal case
      const output = execSync(
        `diff -u --color=always --label "a/${filePath}" --label "b/${filePath}" "${oldFile}" "${newFile}"`,
        { encoding: 'utf8', timeout: 5000 },
      );
      // exit 0 means no differences (shouldn't happen, but handle it)
      return output || '(no differences)';
    } catch (err: any) {
      // exit code 1 = differences found (normal), stderr or code 2 = error
      if (err.status === 1 && err.stdout) {
        return err.stdout;
      }
      return `(diff failed: ${err.message})`;
    }
  } finally {
    try { unlinkSync(oldFile); } catch {}
    try { unlinkSync(newFile); } catch {}
    try { unlinkSync(dir); } catch {}
  }
}
