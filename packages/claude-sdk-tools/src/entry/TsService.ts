import { ITsServerOptions } from '../typescript/ITsServerOptions';
import type { Definition, DefinitionOptions, Diagnostic, DiagnosticSeverity, DiagnosticsOptions, HoverInfo, HoverOptions, ITypeScriptService, Position, Reference, ReferencesOptions } from '../typescript/ITypeScriptService';
import { resolveTsServerPath, TSSERVER_PATH_ENV, TsServerService } from '../typescript/TsServerService';

export type { Definition, DefinitionOptions, Diagnostic, DiagnosticSeverity, DiagnosticsOptions, HoverInfo, HoverOptions, ITypeScriptService, Position, Reference, ReferencesOptions };
export { ITsServerOptions, resolveTsServerPath, TSSERVER_PATH_ENV, TsServerService };
