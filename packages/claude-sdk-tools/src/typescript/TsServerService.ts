import { type ChildProcess, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Definition, DefinitionOptions, Diagnostic, DiagnosticSeverity, DiagnosticsOptions, HoverInfo, HoverOptions, Reference, ReferencesOptions } from './ITypeScriptService';
import { ITypeScriptService } from './ITypeScriptService';

type TsServerResponse = {
  seq: number;
  type: 'response';
  command: string;
  request_seq: number;
  success: boolean;
  body?: unknown;
};

type TsServerDiagnostic = {
  start: { line: number; offset: number };
  end: { line: number; offset: number };
  text: string;
  code: number;
  category: string;
};

type PendingRequest = {
  resolve: (value: TsServerResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type TsServerServiceOptions = {
  /** Working directory for tsserver. Defaults to process.cwd(). */
  cwd?: string;
  /** Timeout in ms for individual tsserver requests. Default 15000. */
  timeout?: number;
};

/**
 * Resolves the tsserver binary path by finding the typescript package
 * relative to this module's location in the dependency tree.
 */
function resolveTsServerPath(): string {
  const require = createRequire(import.meta.url);
  const tsPath = require.resolve('typescript');
  // typescript's main entry is lib/typescript.js; tsserver is at lib/tsserver.js
  return path.join(path.dirname(tsPath), 'tsserver.js');
}

export class TsServerService extends ITypeScriptService {
  readonly #cwd: string;
  readonly #timeout: number;
  #proc: ChildProcess | null = null;
  #seq = 0;
  #buffer = '';
  #pending = new Map<number, PendingRequest>();
  #openFiles = new Set<string>();
  #started = false;

  public constructor(options?: TsServerServiceOptions) {
    super();
    this.#cwd = options?.cwd ?? process.cwd();
    this.#timeout = options?.timeout ?? 15000;
  }

  /**
   * Start the tsserver process. Must be called before any queries.
   * Idempotent: calling start() on an already-started service is a no-op.
   */
  public async start(): Promise<void> {
    if (this.#started) {
      return;
    }

    const tsserverPath = resolveTsServerPath();

    this.#proc = spawn('node', [tsserverPath, '--disableAutomaticTypingAcquisition'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.#cwd,
    });

    this.#proc.stdout?.on('data', (chunk: Buffer) => {
      this.#buffer += chunk.toString();
      this.#processBuffer();
    });

    this.#proc.on('exit', (code) => {
      // Reject all pending requests on unexpected exit
      for (const [seq, pending] of this.#pending) {
        pending.reject(new Error(`tsserver exited with code ${code}`));
        clearTimeout(pending.timer);
        this.#pending.delete(seq);
      }
      this.#started = false;
    });

    this.#started = true;
  }

  /** Stop the tsserver process. */
  public stop(): void {
    if (this.#proc) {
      this.#proc.stdin?.end();
      this.#proc.kill();
      this.#proc = null;
    }
    this.#started = false;
    this.#openFiles.clear();

    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('tsserver stopped'));
    }
    this.#pending.clear();
  }

  public async getDiagnostics(options: DiagnosticsOptions): Promise<Diagnostic[]> {
    if (!this.#started) {
      throw new Error('TsServerService not started. Call start() first.');
    }

    const filePath = path.resolve(this.#cwd, options.file);

    // Open the file if not already open
    if (!this.#openFiles.has(filePath)) {
      await this.#send('open', {
        file: filePath,
        projectRootPath: this.#cwd,
      });
      this.#openFiles.add(filePath);
      // Give tsserver a moment to process the file
      await this.#delay(500);
    }

    const [syntactic, semantic] = await Promise.all([this.#send('syntacticDiagnosticsSync', { file: filePath }), this.#send('semanticDiagnosticsSync', { file: filePath })]);

    const syntacticDiags: TsServerDiagnostic[] = syntactic.success ? ((syntactic.body as TsServerDiagnostic[]) ?? []) : [];
    const semanticDiags: TsServerDiagnostic[] = semantic.success ? ((semantic.body as TsServerDiagnostic[]) ?? []) : [];

    const allDiags = [...syntacticDiags, ...semanticDiags];
    const mapped = allDiags.map((d) => this.#mapDiagnostic(d, filePath));

    // Filter by severity if requested
    if (options.severity && options.severity !== 'all') {
      return mapped.filter((d) => d.severity === options.severity);
    }

    return mapped;
  }

  #mapDiagnostic(raw: TsServerDiagnostic, filePath: string): Diagnostic {
    return {
      file: filePath,
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

  #send(command: string, args: Record<string, unknown>): Promise<TsServerResponse> {
    if (!this.#proc?.stdin) {
      return Promise.reject(new Error('tsserver process not available'));
    }

    const seq = ++this.#seq;
    const msg = JSON.stringify({
      seq,
      type: 'request',
      command,
      arguments: args,
    });

    return new Promise<TsServerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pending.has(seq)) {
          this.#pending.delete(seq);
          reject(new Error(`Timeout waiting for tsserver response to ${command} (seq ${seq})`));
        }
      }, this.#timeout);

      this.#pending.set(seq, { resolve, reject, timer });
      this.#proc?.stdin?.write(`${msg}\n`);
    });
  }

  #processBuffer(): void {
    // tsserver frames: Content-Length: N\r\n\r\n{json}
    while (true) {
      const headerEnd = this.#buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        break;
      }

      const header = this.#buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/);
      if (!match) {
        // Skip non-content lines (tsserver sometimes writes bare newlines)
        this.#buffer = this.#buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = Number.parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;

      if (this.#buffer.length < bodyStart + contentLength) {
        break;
      }

      const body = this.#buffer.slice(bodyStart, bodyStart + contentLength);
      this.#buffer = this.#buffer.slice(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body) as { type: string; request_seq?: number };
        if (msg.type === 'response' && msg.request_seq != null && this.#pending.has(msg.request_seq)) {
          const pending = this.#pending.get(msg.request_seq);
          if (pending) {
            clearTimeout(pending.timer);
            this.#pending.delete(msg.request_seq);
            pending.resolve(msg as TsServerResponse);
          }
        }
        // Ignore events
      } catch {
        // skip unparseable
      }
    }
  }

  public async getHoverInfo(options: HoverOptions): Promise<HoverInfo | null> {
    if (!this.#started) {
      throw new Error('TsServerService not started. Call start() first.');
    }

    const filePath = path.resolve(this.#cwd, options.file);

    if (!this.#openFiles.has(filePath)) {
      await this.#send('open', {
        file: filePath,
        projectRootPath: this.#cwd,
      });
      this.#openFiles.add(filePath);
      await this.#delay(500);
    }

    const response = await this.#send('quickinfo', {
      file: filePath,
      line: options.line,
      offset: options.character,
    });

    if (!response.success || !response.body) {
      return null;
    }

    const body = response.body as { displayString?: string; documentation?: string; kind?: string };
    if (!body.displayString) {
      return null;
    }

    return {
      text: body.displayString,
      documentation: body.documentation || undefined,
      kind: body.kind ?? 'unknown',
    };
  }

  public async getReferences(options: ReferencesOptions): Promise<Reference[]> {
    if (!this.#started) {
      throw new Error('TsServerService not started. Call start() first.');
    }

    const filePath = path.resolve(this.#cwd, options.file);

    if (!this.#openFiles.has(filePath)) {
      await this.#send('open', {
        file: filePath,
        projectRootPath: this.#cwd,
      });
      this.#openFiles.add(filePath);
      await this.#delay(500);
    }

    const response = await this.#send('references', {
      file: filePath,
      line: options.line,
      offset: options.character,
    });

    if (!response.success || !response.body) {
      return [];
    }

    const body = response.body as { refs?: Array<{ file: string; start: { line: number; offset: number }; lineText: string }> };
    if (!body.refs) {
      return [];
    }

    return body.refs.map((ref) => ({
      file: ref.file,
      line: ref.start.line,
      character: ref.start.offset,
      text: ref.lineText,
    }));
  }

  public async getDefinition(options: DefinitionOptions): Promise<Definition[]> {
    if (!this.#started) {
      throw new Error('TsServerService not started. Call start() first.');
    }

    const filePath = path.resolve(this.#cwd, options.file);

    if (!this.#openFiles.has(filePath)) {
      await this.#send('open', {
        file: filePath,
        projectRootPath: this.#cwd,
      });
      this.#openFiles.add(filePath);
      await this.#delay(500);
    }

    const response = await this.#send('definition', {
      file: filePath,
      line: options.line,
      offset: options.character,
    });

    if (!response.success || !response.body) {
      return [];
    }

    const body = response.body as Array<{ file: string; start: { line: number; offset: number } }>;

    return body.map((def) => ({
      file: def.file,
      line: def.start.line,
      character: def.start.offset,
    }));
  }

  #delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
