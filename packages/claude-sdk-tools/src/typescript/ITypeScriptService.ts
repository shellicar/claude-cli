export type DiagnosticSeverity = 'error' | 'warning' | 'suggestion';

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
  abstract getDiagnostics(options: DiagnosticsOptions): Promise<Diagnostic[]>;
  abstract getHoverInfo(options: HoverOptions): Promise<HoverInfo | null>;
  abstract getReferences(options: ReferencesOptions): Promise<Reference[]>;
  abstract getDefinition(options: DefinitionOptions): Promise<Definition[]>;
}
