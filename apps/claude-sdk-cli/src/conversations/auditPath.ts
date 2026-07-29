import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';

/** Where a conversation's audit file lives. One definition, so a move updates every reader at once. */
export const auditPathFor = (fs: IFileSystem, id: string): string => `${fs.homedir()}/.claude/audit/${id}.jsonl`;
