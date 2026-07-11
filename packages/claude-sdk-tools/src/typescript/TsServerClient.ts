import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { dependsOn } from '@shellicar/core-di-lite';
import { ITsServerClient, type TsServerDefinition, type TsServerDiagnostic, type TsServerQuickInfo, type TsServerReference } from './ITsServerClient';
import { ITsServerOptions } from './ITsServerOptions';
import { TsServerError } from './TsServerError';

type TsServerResponse = {
  seq: number;
  type: 'response';
  command: string;
  request_seq: number;
  success: boolean;
  body?: unknown;
};

type PendingRequest = {
  resolve: (value: TsServerResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Env var the launcher sets to the on-disk tsserver.js path. Inside the SEA,
 * import.meta.url is a virtual path with no node_modules beside it, so the
 * binary cannot resolve typescript itself; the launcher (running on the user's
 * Node, with a real path) resolves it and hands the path in through this var.
 */
export const TSSERVER_PATH_ENV = 'CLAUDE_SDK_CLI_TSSERVER_PATH';

/**
 * Resolve the on-disk path to tsserver.js, or null when typescript cannot be
 * found. Prefers the launcher-provided env var (the SEA case); falls back to
 * resolving typescript relative to this module (the dev / npm-with-node_modules
 * case). Returns null instead of throwing so callers can degrade gracefully.
 */
export function resolveTsServerPath(): string | null {
  const fromEnv = process.env[TSSERVER_PATH_ENV];
  if (fromEnv != null && fromEnv !== '') {
    return existsSync(fromEnv) ? fromEnv : null;
  }
  try {
    const require = createRequire(import.meta.url);
    const tsPath = require.resolve('typescript');
    // typescript's main entry is lib/typescript.js; tsserver is at lib/tsserver.js
    const tsserverPath = path.join(path.dirname(tsPath), 'tsserver.js');
    return existsSync(tsserverPath) ? tsserverPath : null;
  } catch {
    return null;
  }
}

export class TsServerClient extends ITsServerClient {
  @dependsOn(ITsServerOptions) private readonly options!: ITsServerOptions;
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(ILogger) private readonly logger!: ILogger;
  #proc: ChildProcess | null = null;
  #seq = 0;
  #buffer = '';
  #pending = new Map<number, PendingRequest>();
  #openFiles = new Set<string>();
  #started = false;

  /**
   * Spawn the tsserver process. Idempotent while running; after stop() a fresh
   * start() re-spawns, so one instance is cycled per tool-execution block. The
   * spawn cwd is the user's $HOME: tsserver selects a file's project by the
   * file's absolute path, so the spawn location is inert (proven by the
   * spawn-cwd-irrelevance test).
   */
  public async start(): Promise<void> {
    if (this.#started) {
      return;
    }

    const tsserverPath = this.options.tsserverPath;
    if (tsserverPath == null) {
      // typescript is not on disk (the SEA without the launcher-provided path).
      // The TS tools were already left out of the suite (tsAvailable=false), so
      // this branch is not reached in practice; the guard keeps a direct start()
      // from throwing.
      return;
    }

    this.#buffer = '';
    this.#seq = 0;
    this.#openFiles.clear();

    const proc = spawn('node', [tsserverPath, '--disableAutomaticTypingAcquisition'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.fs.homedir(),
    });
    this.#proc = proc;

    // Every handler is bound to `proc` and guarded on it still being the current
    // process. stop() kills the process but its 'exit'/'data' events fire on a
    // later tick — by which point a new block may have spawned a replacement.
    // Without the guard, the superseded process's late 'exit' would reject the
    // replacement's in-flight requests (surfaced by the freshness proof:
    // "tsserver exited with code null") and its late 'data' would corrupt the
    // replacement's buffer.
    proc.stdout?.on('data', (chunk: Buffer) => {
      if (this.#proc !== proc) {
        return;
      }
      this.#buffer += chunk.toString();
      this.#processBuffer();
    });

    proc.stdin?.on('error', (err) => {
      if (this.#proc !== proc) {
        return;
      }
      // EPIPE when tsserver exits mid-write is expected during teardown; the
      // 'error'/'exit' handlers surface the death. Trace it rather than
      // swallowing the pipe error silently.
      this.logger.debug('tsserver stdin error', err);
    });

    proc.on('error', (err) => {
      if (this.#proc !== proc) {
        return;
      }
      // The process itself failed (e.g. it could not spawn). Surface it as a
      // server-side failure to every in-flight request and leave a trace,
      // rather than swallowing it.
      this.logger.error('tsserver process error', err);
      this.#failPending(new TsServerError(`tsserver process error: ${err.message}`));
      this.#started = false;
    });

    proc.on('exit', (code) => {
      if (this.#proc !== proc) {
        // A superseded process exiting after stop() replaced it; its pending
        // requests were already rejected by stop().
        return;
      }
      // Reaching here is an unexpected mid-block death: stop() nulls #proc
      // before killing, so a clean teardown is guarded out above.
      this.logger.warn(`tsserver exited mid-block with code ${code}`);
      this.#failPending(new TsServerError(`tsserver exited with code ${code}`));
      this.#started = false;
    });

    this.#started = true;
  }

  /** Kill the tsserver process and reset per-process state. */
  public stop(): void {
    if (this.#proc) {
      this.#proc.stdin?.end();
      this.#proc.kill();
      this.#proc = null;
    }
    this.#started = false;
    this.#openFiles.clear();
    this.#failPending(new Error('tsserver stopped'));
  }

  public async open(file: string, projectRootPath: string): Promise<void> {
    this.#ensureStarted();
    if (this.#openFiles.has(file)) {
      return;
    }
    // projectRootPath is passed through from the bridge (= the live cwd),
    // unchanged from today's behaviour: tsserver selects the project by the
    // file's absolute path, and projectRootPath stays the caller-supplied hint.
    await this.#send('open', { file, projectRootPath });
    this.#openFiles.add(file);
  }

  public async getSyntacticDiagnostics(file: string): Promise<TsServerDiagnostic[]> {
    const res = await this.#send('syntacticDiagnosticsSync', { file });
    if (!res.success) {
      throw new TsServerError(`tsserver syntacticDiagnosticsSync failed for ${file}`);
    }
    return (res.body as TsServerDiagnostic[]) ?? [];
  }

  public async getSemanticDiagnostics(file: string): Promise<TsServerDiagnostic[]> {
    const res = await this.#send('semanticDiagnosticsSync', { file });
    if (!res.success) {
      throw new TsServerError(`tsserver semanticDiagnosticsSync failed for ${file}`);
    }
    return (res.body as TsServerDiagnostic[]) ?? [];
  }

  public async quickInfo(file: string, line: number, offset: number): Promise<TsServerQuickInfo | null> {
    const res = await this.#send('quickinfo', { file, line, offset });
    // Unlike diagnostics, tsserver answers a no-symbol position with
    // success:false — a legitimate "nothing here", not a server failure. Real
    // failures (timeout, process death) already reject in #send, so returning
    // null here does not hide a broken server.
    if (!res.success || !res.body) {
      return null;
    }
    return res.body as TsServerQuickInfo;
  }

  public async references(file: string, line: number, offset: number): Promise<TsServerReference[]> {
    const res = await this.#send('references', { file, line, offset });
    if (!res.success) {
      throw new TsServerError(`tsserver references failed for ${file}`);
    }
    const body = res.body as { refs?: TsServerReference[] } | undefined;
    return body?.refs ?? [];
  }

  public async definition(file: string, line: number, offset: number): Promise<TsServerDefinition[]> {
    const res = await this.#send('definition', { file, line, offset });
    if (!res.success) {
      throw new TsServerError(`tsserver definition failed for ${file}`);
    }
    return (res.body as TsServerDefinition[]) ?? [];
  }

  #failPending(error: Error): void {
    for (const [seq, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.#pending.delete(seq);
    }
  }

  #ensureStarted(): void {
    if (!this.#started) {
      throw new Error('TsServerClient not started. Call start() first.');
    }
  }

  #send(command: string, args: Record<string, unknown>): Promise<TsServerResponse> {
    if (!this.#proc?.stdin) {
      return Promise.reject(new TsServerError('tsserver process not available'));
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
          reject(new TsServerError(`Timeout waiting for tsserver response to ${command} (seq ${seq}) after ${this.options.timeoutMs}ms`));
        }
      }, this.options.timeoutMs);

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
        // Ignore events (sync commands only; the exclusive geterr channel is not used).
      } catch {
        // skip unparseable
      }
    }
  }
}
