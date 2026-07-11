import { ITsServerClient, type TsServerDefinition, type TsServerDiagnostic, type TsServerQuickInfo, type TsServerReference } from '../typescript/ITsServerClient';
import { DEFAULT_TSSERVER_TIMEOUT_MS, ITsServerOptions } from '../typescript/ITsServerOptions';
import type { Definition, DefinitionOptions, Diagnostic, DiagnosticSeverity, DiagnosticsOptions, HoverInfo, HoverOptions, Position, Reference, ReferencesOptions } from '../typescript/ITypeScriptService';
import { ITypeScriptService } from '../typescript/ITypeScriptService';
import { TsServerBridge } from '../typescript/TsServerBridge';
import { resolveTsServerPath, TSSERVER_PATH_ENV, TsServerClient } from '../typescript/TsServerClient';

export type { Definition, DefinitionOptions, Diagnostic, DiagnosticSeverity, DiagnosticsOptions, HoverInfo, HoverOptions, Position, Reference, ReferencesOptions, TsServerDefinition, TsServerDiagnostic, TsServerQuickInfo, TsServerReference };
export { DEFAULT_TSSERVER_TIMEOUT_MS, ITsServerClient, ITsServerOptions, ITypeScriptService, resolveTsServerPath, TSSERVER_PATH_ENV, TsServerBridge, TsServerClient };
