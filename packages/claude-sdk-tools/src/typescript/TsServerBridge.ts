import path from 'node:path';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { dependsOn } from '@shellicar/core-di-lite';
import { ITsServerClient, type TsServerDiagnostic } from './ITsServerClient';
import type { Definition, DefinitionOptions, Diagnostic, DiagnosticSeverity, DiagnosticsOptions, HoverInfo, HoverOptions, Reference, ReferencesOptions } from './ITypeScriptService';
import { ITypeScriptService } from './ITypeScriptService';

/**
 * The bridge between the model's TS tool calls and the tsserver client. Resolves
 * relative file arguments against the live working directory, drives the client's
 * raw commands, and maps the raw tsserver shapes to the tool output types.
 *
 * Owns the on-demand, per-block server lifecycle: the client is started lazily on
 * the first TS-tool call of a block (a single shared promise every parallel TS
 * tool in the block awaits) and stopped on `blockEnded()`. A fresh spawn per block
 * reads the file from disk, so diagnostics are never stale across turns; and the
 * spawn location is $HOME, so relative-path resolution tracks the live cwd here
 * rather than a cwd frozen into the process.
 *
 * `blockEnded` matches the SDK's `ToolBlockLifetime` structurally, so each TS
 * tool declares this one instance as its `blockLifetime`; the build-tools step
 * collects it (deduped) and the block notifier drives `blockEnded` per block.
 */
export class TsServerBridge extends ITypeScriptService {
  @dependsOn(ITsServerClient) private readonly client!: ITsServerClient;
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  #startPromise: Promise<void> | null = null;

  /** Called once per tool block by the block notifier. Stops the block's
   * server (if one was started) and clears the memo so the next block spawns
   * fresh. No-op when no TS tool ran in the block. */
  public async blockEnded(): Promise<void> {
    const pending = this.#startPromise;
    this.#startPromise = null;
    if (pending == null) {
      return;
    }
    await pending;
    this.client.stop();
  }

  public async getDiagnostics(options: DiagnosticsOptions): Promise<Diagnostic[]> {
    const file = await this.#openResolved(options.file);
    const [syntactic, semantic] = await Promise.all([this.client.getSyntacticDiagnostics(file), this.client.getSemanticDiagnostics(file)]);
    const mapped = [...syntactic, ...semantic].map((d) => this.#mapDiagnostic(d, file));
    if (options.severity && options.severity !== 'all') {
      return mapped.filter((d) => d.severity === options.severity);
    }
    return mapped;
  }

  public async getHoverInfo(options: HoverOptions): Promise<HoverInfo | null> {
    const file = await this.#openResolved(options.file);
    const info = await this.client.quickInfo(file, options.line, options.character);
    if (!info?.displayString) {
      return null;
    }
    return {
      text: info.displayString,
      documentation: info.documentation || undefined,
      kind: info.kind ?? 'unknown',
    };
  }

  public async getReferences(options: ReferencesOptions): Promise<Reference[]> {
    const file = await this.#openResolved(options.file);
    const refs = await this.client.references(file, options.line, options.character);
    return refs.map((ref) => ({
      file: ref.file,
      line: ref.start.line,
      character: ref.start.offset,
      text: ref.lineText,
    }));
  }

  public async getDefinition(options: DefinitionOptions): Promise<Definition[]> {
    const file = await this.#openResolved(options.file);
    const defs = await this.client.definition(file, options.line, options.character);
    return defs.map((def) => ({
      file: def.file,
      line: def.start.line,
      character: def.start.offset,
    }));
  }

  /** Start the block's server (once), resolve the file argument against the live
   * cwd, open it on the server (passing that live cwd as projectRootPath), and
   * return the absolute path. */
  async #openResolved(file: string): Promise<string> {
    this.#startPromise ??= this.client.start();
    await this.#startPromise;
    const cwd = this.fs.cwd();
    const absolute = path.resolve(cwd, file);
    await this.client.open(absolute, cwd);
    return absolute;
  }

  #mapDiagnostic(raw: TsServerDiagnostic, file: string): Diagnostic {
    return {
      file,
      line: raw.start.line,
      character: raw.start.offset,
      message: raw.text,
      code: raw.code,
      severity: this.#mapCategory(raw.category),
    };
  }

  #mapCategory(category: string): DiagnosticSeverity {
    switch (category) {
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      case 'suggestion':
        return 'suggestion';
      default:
        return 'error';
    }
  }
}
