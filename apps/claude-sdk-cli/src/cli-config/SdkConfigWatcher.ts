import { type FSWatcher, watch } from 'node:fs';
import { CONFIG_PATH, LOCAL_CONFIG_PATH } from './consts';
import { loadCliConfig } from './loadCliConfig';
import type { ResolvedSdkConfig } from './types';

export class SdkConfigWatcher {
  #config: ResolvedSdkConfig;
  #pending = false;
  #debounce: ReturnType<typeof setTimeout> | undefined;
  #watchers: FSWatcher[] = [];

  public constructor() {
    ({ config: this.#config } = loadCliConfig());

    const schedule = () => {
      clearTimeout(this.#debounce);
      this.#debounce = setTimeout(() => {
        this.#pending = true;
      }, 100);
    };

    for (const p of [CONFIG_PATH, LOCAL_CONFIG_PATH]) {
      try {
        this.#watchers.push(watch(p, schedule));
      } catch {
        // file may not exist yet
      }
    }
  }

  public get config(): ResolvedSdkConfig {
    return this.#config;
  }

  /**
   * If a reload is pending, loads fresh config, clears the flag, and returns
   * the new config. Returns null if nothing changed since the last call.
   */
  public checkReload(): ResolvedSdkConfig | null {
    if (!this.#pending) {
      return null;
    }
    this.#pending = false;
    ({ config: this.#config } = loadCliConfig());
    return this.#config;
  }

  public dispose(): void {
    for (const w of this.#watchers) {
      w.close();
    }
    clearTimeout(this.#debounce);
  }
}
