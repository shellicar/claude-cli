export type DiagnosticSeverity = 'error' | 'warning' | 'suggestion' | 'unknown';

export type Diagnostic = {
  file: string;
  line: number;
  character: number;
  message: string;
  code: number;
  severity: DiagnosticSeverity;
};

export type DiagnosticsOptions = {
  file: string;
  severity?: DiagnosticSeverity | 'all';
};

export type Position = {
  file: string;
  line: number;
  character: number;
};

export type HoverInfo = {
  text: string;
  documentation?: string;
  kind: string;
};

export type HoverOptions = Position;

export type Reference = {
  file: string;
  line: number;
  character: number;
  text: string;
};

export type ReferencesOptions = Position;

export type Definition = {
  file: string;
  line: number;
  character: number;
};

export type DefinitionOptions = Position;

export abstract class ITypeScriptService {
  public abstract getDiagnostics(options: DiagnosticsOptions): Promise<Diagnostic[]>;
  public abstract getHoverInfo(options: HoverOptions): Promise<HoverInfo | null>;
  public abstract getReferences(options: ReferencesOptions): Promise<Reference[]>;
  public abstract getDefinition(options: DefinitionOptions): Promise<Definition[]>;
  /** Ends the per-block server lifecycle the implementation owns. Declared here
   * so the live DI contract is this interface, not the concrete bridge; it also
   * satisfies the SDK's structural `ToolBlockLifetime` for the tools' block
   * lifetime declaration. */
  public abstract blockEnded(): Promise<void>;
}
