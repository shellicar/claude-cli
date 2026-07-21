import { mergeRawConfigs } from '@shellicar/claude-core/config';
import type { IConfigOptions } from '@shellicar/claude-core/Config/IConfigOptions';
import type { IConfigFileReader, IConfigWatcher } from '@shellicar/claude-core/Config/interfaces';
import type { ConfigWatchHandle } from '@shellicar/claude-core/Config/types';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IRulesConfigProvider, RulesConfigGate, type BlockedCommand, type RuleOverrideMap, type RulesConfigNotice } from '@shellicar/claude-sdk-tools/ExecV3';

/** Reads and merges only `tools` off the same files sdkConfigSchema reads, independently of it.
 *  A file that fails to parse contributes nothing (matches readConfig's own JSON-parse handling)
 *  rather than aborting \u2014 this section's own validation (inside RulesConfigGate) is what decides
 *  pass/fail, not JSON syntax elsewhere in the document. */
function readToolsRaw(paths: readonly string[], reader: IConfigFileReader): unknown {
  const raws: Record<string, unknown>[] = [];
  for (const path of paths) {
    if (!reader.exists(path)) {
      continue;
    }
    try {
      raws.push(JSON.parse(reader.read(path)) as Record<string, unknown>);
    } catch {
      // Skip: the same "contributes nothing" handling readConfig.ts gives a bad JSON file.
    }
  }
  const merged = raws.reduce<Record<string, unknown>>((acc, cur) => mergeRawConfigs(acc, cur), {});
  return merged.tools ?? {};
}

/**
 * A wholly separate, independently-watched validation path for `tools.rules`/`tools.blockedCommands`
 * — never routed through sdkConfigSchema's own whole-document parse. That parse-and-throw mechanism
 * (readConfig + ConfigReloader) already gives fail-fast-at-boot / keep-previous-on-reload for the
 * *whole* document, but at document granularity: a broken `tools.rules` edit would otherwise block
 * every other, unrelated fix in the same file from landing until the rules are corrected. This class
 * isolates just that one section, watching independently of ConfigReloader so an edit elsewhere in
 * the file still takes effect on a reload even while this section stays pinned to its last-good value.
 *
 * Read live (`IRulesConfigProvider`), never pushed: ExecV3 reads `.rules`/`.blockedCommands` fresh
 * on every call, so a fix here is reflected on the very next call, with no tool rebuild.
 */
export class ConfigRulesConfigProvider extends IRulesConfigProvider {
  readonly #gate: RulesConfigGate;
  readonly #watch: ConfigWatchHandle;
  readonly #listeners = new Set<(notice: RulesConfigNotice) => void>();

  public constructor(
    private readonly options: IConfigOptions,
    private readonly reader: IConfigFileReader,
    watcher: IConfigWatcher,
    private readonly logger: ILogger,
  ) {
    super();
    // Eager, throws on an invalid initial config \u2014 the same fail-fast-at-boot the rest of the
    // config gets from readConfig, just scoped to this one section.
    this.#gate = new RulesConfigGate(readToolsRaw(this.options.paths, this.reader));
    this.#watch = watcher.watch(this.options.paths, () => this.refresh());
  }

  public get rules(): RuleOverrideMap {
    return this.#gate.state.rules;
  }

  public get blockedCommands(): BlockedCommand[] {
    return this.#gate.state.blockedCommands;
  }

  /** Subscribe to notices this section produces on a live reload (never on construction — the
   *  initial config either succeeds silently or throws). Returns an unsubscribe function, matching
   *  ConfigLoader.onChange's shape. Surfacing a notice to the user (e.g. splicing it into the
   *  conversation) is the caller's job — this class only decides *that* something notice-worthy
   *  happened, not how it is shown. */
  public onNotice(listener: (notice: RulesConfigNotice) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  public refresh(): void {
    const notice = this.#gate.update(readToolsRaw(this.options.paths, this.reader));
    if (notice === null) {
      return;
    }
    if (notice.kind === 'invalid') {
      this.logger.warn('tools.rules/tools.blockedCommands failed validation, keeping the previous rules', { error: notice.error });
    } else if (notice.kind === 'recovered') {
      this.logger.info('tools.rules/tools.blockedCommands recovered after a previous invalid edit');
    } else {
      this.logger.info('tools.rules/tools.blockedCommands updated');
    }
    for (const listener of this.#listeners) {
      listener(notice);
    }
  }

  public [Symbol.dispose](): void {
    this.#watch[Symbol.dispose]();
  }
}
