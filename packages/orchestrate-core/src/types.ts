/** Filesystem permission tiers, named after Unix's own model: `list` is directory entries, `read`
 *  is file content, the way `r` differs on a directory and a file. */
export type FsOperation = 'fs.list' | 'fs.read' | 'fs.write' | 'fs.delete' | 'fs.exec';

/** What a call does to the world. `escalate` crosses a privilege boundary and is never a filesystem
 *  operation. Future categories join here. */
export type Operation = 'none' | FsOperation | 'escalate';

/** How a stage joins the next: pipe its bytes, run on success, run on failure, or merely follow. */
export type Op = '|' | '&&' | '||';

/** Where a stage reads its bytes from. */
export type Reader = { read: (max?: number) => Promise<Buffer | undefined> };

/** Where a stage writes its bytes to. */
export type Writer = {
  write: (bytes: Buffer) => Promise<boolean>;
  end: () => void;
  fail: (err: unknown) => void;
};

/** How a stage ended, as far as its own tool can know. Everything else is the run's to say. */
export type Ended = { kind: 'finished' } | { kind: 'failed'; code: number } | { kind: 'signalled'; signal: string };

/** A running stage. `ended` is answerable once it is finished with; `stop` ends it early and waits
 *  for whatever is behind it to be finished with. */
export type Running = {
  ended: () => Ended;
  stop: () => Promise<void>;
};

/** A tool a run can execute. It writes bytes, reads bytes, and answers for itself. */
export type Tool = {
  name: string;
  operations: (input: Record<string, unknown>) => Operation[];
  /** The input field an argument list is put into, for a tool that takes one. */
  takesListIn?: string;
  run: (input: Record<string, unknown>, upstream: Reader | undefined, out: Writer) => Running;
};

export type ToolStage = { kind: 'tool'; tool: Tool; input: Record<string, unknown>; op?: Op };
/** Turns what came before it into an argument list for the stage after it. */
export type XargsStage = { kind: 'xargs' };
/** Binds a name to what came before it. */
export type SetStage = { kind: 'set'; name: string };
export type Stage = ToolStage | XargsStage | SetStage;
