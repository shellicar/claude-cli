import { type FSWatcher, watch } from 'node:fs';
import { logger } from '../logger';
import { CONFIG_PATH, LOCAL_CONFIG_PATH } from './consts';
import { loadCliConfig } from './loadCliConfig';
import type { ResolvedSdkConfig } from './types';

export type ConfigChangeListener = (config: ResolvedSdkConfig) => void;

export class SdkConfigWatcher {
  #config: ResolvedSdkConfig;
  #debounce: ReturnType<typeof setTimeout> | undefined;
  #watchers: FSWatcher[] = [];
  #onChange: ConfigChangeListener;

  public constructor(onChange: ConfigChangeListener) {
    this.#onChange = onChange;
    ({ config: this.#config } = loadCliConfig());

    const handleEvent = () => {
      clearTimeout(this.#debounce);
      this.#debounce = setTimeout(() => this.#reload(), 100);
    };

    for (const p of [CONFIG_PATH, LOCAL_CONFIG_PATH]) {
      try {
        this.#watchers.push(watch(p, handleEvent));
      } catch {
        // file may not exist yet
      }
    }
  }

  public get config(): ResolvedSdkConfig {
    return this.#config;
  }

  public dispose(): void {
    for (const w of this.#watchers) {
      w.close();
    }
    clearTimeout(this.#debounce);
  }

  #reload(): void {
    try {
      ({ config: this.#config } = loadCliConfig());
    } catch (err) {
      logger.warn('config reload failed, keeping previous config', { error: String(err) });
      return;
    }
    this.#onChange(this.#config);
  }
}
