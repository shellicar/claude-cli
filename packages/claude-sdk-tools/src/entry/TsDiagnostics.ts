import { createTsDiagnostics } from '../TsDiagnostics/TsDiagnostics';

export type { TsDiagnosticsOutput } from '../TsDiagnostics/TsDiagnostics';
export type { Diagnostic, DiagnosticSeverity, DiagnosticsOptions, ITypeScriptService, Position } from '../typescript/ITypeScriptService';
export { TsServerService, type TsServerServiceOptions } from '../typescript/TsServerService';
export { createTsDiagnostics };
