import { dependsOn } from '@shellicar/core-di-lite';
import type { z } from 'zod';
import { IFileSystem } from '../fs/interfaces';
import { ILogger } from '../logging/ILogger';
import { ConfigLoader } from './ConfigLoader';
import { IConfigOptions } from './IConfigOptions';
import { IConfigFileReader } from './interfaces';
import { readConfig } from './readConfig';
import type { ConfigResult } from './types';

/**
 * Re-reads the config when a watched file changes and pushes the fresh result
 * into the holder. Pure property injection — every input it needs is a
 * dependency, so there is no constructor side effect and no two-phase wiring.
 *
 * Reload semantics match the previous loader's reload behaviour: a JSON parse
 * error or a schema failure keeps the previous config (logged, not applied);
 * an unchanged result is a no-op; only a changed, valid result is applied.
 */
export class ConfigReloader<T extends z.ZodType = z.ZodType> {
  @dependsOn(IConfigOptions) private readonly options!: IConfigOptions<T>;
  @dependsOn(IConfigFileReader) private readonly reader!: IConfigFileReader;
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(ConfigLoader) private readonly loader!: ConfigLoader<T>;
  @dependsOn(ILogger) private readonly logger!: ILogger;
  #debounce: ReturnType<typeof setTimeout> | undefined;

  public scheduleReload(): void {
    const debounceMs = this.options.debounceMs ?? 100;
    if (debounceMs === 0) {
      this.reload();
      return;
    }
    if (this.#debounce !== undefined) {
      clearTimeout(this.#debounce);
    }
    this.#debounce = setTimeout(() => {
      this.#debounce = undefined;
      this.reload();
    }, debounceMs);
  }

  public reload(): void {
    let result: ConfigResult<z.infer<T>>;
    try {
      result = readConfig(this.options, this.reader, this.fs);
    } catch (err) {
      this.logger.warn('config reload failed schema validation, keeping previous config', { error: String(err) });
      return;
    }

    // Parse errors during reload are treated as transient: keep previous
    // state rather than advancing with partial data.
    if (result.warnings.length > 0) {
      this.logger.warn('config reload encountered parse errors, keeping previous config', { warnings: result.warnings });
      return;
    }

    if (JSON.stringify(this.loader.config) === JSON.stringify(result.config)) {
      return;
    }

    this.loader.apply(result);
  }
}
