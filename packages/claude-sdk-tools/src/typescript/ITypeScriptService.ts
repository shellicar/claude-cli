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

export abstract class ITypeScriptService {
  abstract getDiagnostics(options: DiagnosticsOptions): Promise<Diagnostic[]>;
}
