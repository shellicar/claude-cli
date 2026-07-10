/** A diagnostic as tsserver reports it over the wire (1-based line/offset). */
export type TsServerDiagnostic = {
  start: { line: number; offset: number };
  end: { line: number; offset: number };
  text: string;
  code: number;
  category: string;
};

/** The `quickinfo` response body. */
export type TsServerQuickInfo = {
  displayString?: string;
  documentation?: string;
  kind?: string;
};

/** One entry of the `references` response body's `refs`. */
export type TsServerReference = {
  file: string;
  start: { line: number; offset: number };
  lineText: string;
};

/** One entry of the `definition` response body. */
export type TsServerDefinition = {
  file: string;
  start: { line: number; offset: number };
};

/**
 * The anti-corruption API over a single tsserver child process: our thin,
 * typed surface on top of tsserver's wire protocol. Owns the process and the
 * framing; takes absolute paths only (the file and its projectRootPath, both
 * supplied by the bridge); knows nothing about tool inputs, how those paths
 * were resolved, or the model-facing output shapes.
 *
 * Lifecycle is caller-driven and restartable: `start()` spawns, `stop()` kills
 * and resets, so one instance is cycled once per tool-execution block.
 */
export abstract class ITsServerClient {
  public abstract start(): Promise<void>;
  public abstract stop(): void;
  public abstract open(file: string, projectRootPath: string): Promise<void>;
  public abstract close(file: string): Promise<void>;
  public abstract getSyntacticDiagnostics(file: string): Promise<TsServerDiagnostic[]>;
  public abstract getSemanticDiagnostics(file: string): Promise<TsServerDiagnostic[]>;
  public abstract quickInfo(file: string, line: number, offset: number): Promise<TsServerQuickInfo | null>;
  public abstract references(file: string, line: number, offset: number): Promise<TsServerReference[]>;
  public abstract definition(file: string, line: number, offset: number): Promise<TsServerDefinition[]>;
}
