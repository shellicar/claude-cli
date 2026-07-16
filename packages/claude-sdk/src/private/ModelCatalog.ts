import versionJson from '@shellicar/build-version/version';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { AnthropicAuth } from './Client/Auth/AnthropicAuth';
import { customFetch } from './http/customFetch';

const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1000';
const ANTHROPIC_VERSION = '2023-06-01';

/** One model as the catalogue exposes it: the sendable id and its human label. */
export type ModelInfo = {
  readonly id: string;
  readonly displayName: string;
};

/**
 * The set of models the account can address, as reported by Anthropic's
 * `/v1/models` endpoint. General infrastructure, not model-select-private: any
 * feature that needs the live model list (model override, support/settings
 * views) reads it here rather than hardcoding ids.
 */
export abstract class IModelCatalog {
  public abstract list(): Promise<readonly ModelInfo[]>;
}

/**
 * Fetches the model list over the same OAuth-bearer transport the message
 * client uses (the `/v1/models` endpoint accepts the claudeAiOauth token we
 * already hold — no API key). Lazy and memoised: the first `list` fetches and
 * caches for the process lifetime; a failed fetch returns an empty list and is
 * NOT cached, so a later call retries. Concurrent first calls share one
 * in-flight request.
 *
 * A caller must treat the list as advisory, never a gate: an empty result
 * (offline, error, or a just-released model missing from the list) means "can't
 * confirm", not "invalid". The list exists to catch typos, not to restrict.
 */
export class ModelCatalog extends IModelCatalog {
  readonly #auth: AnthropicAuth;
  readonly #logger: ILogger;
  readonly #fetch: typeof fetch;
  readonly #defaultHeaders: Record<string, string> = {
    'user-agent': `@shellicar/claude-sdk/${versionJson.version}`,
  };
  #cache: readonly ModelInfo[] | null = null;
  #inFlight: Promise<readonly ModelInfo[]> | null = null;

  public constructor(auth: AnthropicAuth, logger: ILogger) {
    super();
    this.#auth = auth;
    this.#logger = logger;
    this.#fetch = customFetch(logger) as typeof fetch;
  }

  public async list(): Promise<readonly ModelInfo[]> {
    if (this.#cache !== null) {
      return this.#cache;
    }
    this.#inFlight ??= this.#load();
    return this.#inFlight;
  }

  async #load(): Promise<readonly ModelInfo[]> {
    try {
      const models = await this.#fetchModels();
      this.#cache = models;
      return models;
    } catch (err) {
      // Advisory data: a failed fetch degrades to "no confirmation", never an
      // error the caller must handle. Not cached, so the next call retries.
      this.#logger.warn('model catalogue fetch failed', err);
      return [];
    } finally {
      this.#inFlight = null;
    }
  }

  async #fetchModels(): Promise<readonly ModelInfo[]> {
    const { claudeAiOauth } = await this.#auth.getCredentials();
    const response = await this.#fetch(MODELS_URL, {
      method: 'GET',
      headers: {
        'anthropic-version': ANTHROPIC_VERSION,
        authorization: `Bearer ${claudeAiOauth.accessToken}`,
        ...this.#defaultHeaders,
      },
    });
    if (!response.ok) {
      throw new Error(`models request failed: ${response.status} ${response.statusText}`);
    }
    const json = (await response.json()) as { data?: ReadonlyArray<{ id?: unknown; display_name?: unknown }> };
    const data = json.data ?? [];
    const models: ModelInfo[] = [];
    for (const entry of data) {
      if (typeof entry.id === 'string') {
        models.push({ id: entry.id, displayName: typeof entry.display_name === 'string' ? entry.display_name : entry.id });
      }
    }
    return models;
  }
}
