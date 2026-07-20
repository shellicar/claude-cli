import path from 'node:path';
import type { BetaToolSearchToolBm25_20251119, BetaToolSearchToolRegex20251119 } from '@anthropic-ai/sdk/resources/beta.mjs';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { AnthropicBeta, type BetaToolUnion, CacheTtl, type DurableConfig, IDurableConfigProvider } from '@shellicar/claude-sdk';
import { buildSkillCatalogue } from '@shellicar/claude-sdk-tools/Skill';
import { dependsOn } from '@shellicar/core-di-lite';
import { buildAtuTransform, withPathNote } from '../buildAtuTransform.js';
import { buildServerTools } from '../buildServerTools.js';
import { composeSystemPrompts } from '../composeSystemPrompts.js';
import { SystemPromptLoader } from '../SystemPromptLoader.js';
import { AppToolsService } from './AppToolsService.js';
import { IRuntimeOptions } from './IRuntimeOptions.js';
import { ModelOverrides } from './ModelOverrides.js';

// Appended to every marked path field's description in the wire schema the model reads, so the model
// knows a path is normalised. Mirrors the expander wired in container.ts (expandPath + resolve-to-cwd);
// keep the two in step if the normalisation changes.
const PATH_NOTE = 'Normalised to an absolute path before use: ~ and $VAR are expanded, and a relative path is resolved against the working directory.';

export class DurableConfigFactory extends IDurableConfigProvider {
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(ModelOverrides) private readonly overrides!: ModelOverrides;
  @dependsOn(AppToolsService) private readonly appTools!: AppToolsService;
  @dependsOn(SystemPromptLoader) private readonly systemPromptLoader!: SystemPromptLoader;
  @dependsOn(IRuntimeOptions) private readonly runtime!: IRuntimeOptions;
  @dependsOn(ILogger) private readonly logger!: ILogger;
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  #resolvedSystemPrompts: string[] = [];
  #systemPromptSessionId: string | null = null;
  #cachedReminders: string[] | undefined;
  #skillCatalogue: string | null = null;
  #identityBody: string | null = null;

  /**
   * The durable config for the current turn, derived on read from the live
   * in-memory state (config holder, model overrides, resolved system prompts,
   * cached reminders). No shared mutable object is held or rewritten: every
   * read builds a fresh value, so consumers see current values without
   * re-injection.
   */
  public get config(): DurableConfig {
    return { ...this.#build(), cachedReminders: this.#cachedReminders };
  }

  /**
   * Reads the SYSTEM.md sources and composes them with the config inline text
   * and the --system flag into the system-prompt blocks. Genuine async file
   * I/O over an already-constructed object, not a construction or wiring step:
   * called at startup and again when the session changes.
   */
  public async resolveSystemPromptsFor(sessionId: string): Promise<void> {
    const cfg = this.configLoader.config.systemPrompt;
    const fileSections = cfg.enabled ? await this.systemPromptLoader.getSections(cfg.sources) : [];
    this.#resolvedSystemPrompts = composeSystemPrompts({ fileSections, configText: cfg.text, flagText: this.runtime.systemFlagText });
    this.#systemPromptSessionId = sessionId;
  }

  /**
   * Scans the configured skill roots once and builds the catalogue reminder the next `config` read
   * folds into `cachedReminders`. Genuine async file I/O over an already-constructed object, called at
   * startup — the roots are fixed for the session (a live re-scan on change is a separate concern).
   * Each root is expanded (~/$VAR, then resolved against cwd) to the same absolute form the Skill tool
   * resolves against, so the listed names match what `load` can find.
   */
  public async resolveSkillCatalogue(): Promise<void> {
    const configured = this.configLoader.config.skillDirs;
    const dirs = configured.map((d: string) => path.resolve(this.fs.cwd(), expandPath(d, this.fs)));
    this.logger.info('resolving skill catalogue', { cwd: this.fs.cwd(), configured, expanded: dirs });
    this.#skillCatalogue = await buildSkillCatalogue(this.fs, dirs, this.logger);
    this.logger.info('skill catalogue resolved', { present: this.#skillCatalogue != null, chars: this.#skillCatalogue?.length ?? 0 });
  }

  public needsSystemPromptResolve(sessionId: string): boolean {
    return this.#systemPromptSessionId !== sessionId;
  }

  public getEffectiveModel(): string {
    return this.overrides.model ?? this.configLoader.config.model;
  }

  public getEffectiveThinkingEnabled(): boolean {
    const t = this.overrides.thinking;
    if (t === 'on') {
      return true;
    }
    if (t === 'off') {
      return false;
    }
    return this.configLoader.config.thinking.enabled;
  }

  public getEffectiveEffort() {
    return this.overrides.effort ?? this.configLoader.config.thinking.effort;
  }

  /**
   * Sets the claude.md reminder text the next `config` read folds in. Call
   * before each turn so `QueryRunner` and `AgentMessageHandler` see the current
   * reminders. Stores the input only; no shared config object is mutated — the
   * `config` getter derives the rest from current state on read.
   */
  public update(claudeMdContent?: string | null): void {
    // Compose the cached reminder run: the skills catalogue (scanned once at startup) leads, then the
    // per-turn CLAUDE.md content. Each entry becomes its own <system-reminder> block; a single cache
    // breakpoint covers the whole run.
    const reminders = [this.#skillCatalogue, claudeMdContent].filter((r): r is string => r != null && r.length > 0);
    this.#cachedReminders = reminders.length > 0 ? reminders : undefined;
    this.logger.debug('cachedReminders composed', { catalogue: this.#skillCatalogue != null, claudeMd: claudeMdContent != null && claudeMdContent.length > 0, blocks: this.#cachedReminders?.length ?? 0 });
  }

  /**
   * Sets the live system-identity body the next `config` read folds in as the
   * first (base) system prompt. Read fresh from disk per turn by the caller, so
   * the model always sees the current file — empty or null contributes nothing.
   */
  public updateIdentityBody(body: string | null): void {
    this.#identityBody = body;
  }

  #build(): DurableConfig {
    const atuEnabled = this.configLoader.config.advancedTools.enabled;
    const serverTools: BetaToolUnion[] = buildServerTools(this.configLoader.config.serverTools, this.configLoader.config.advancedTools.codeExecutionTool, this.logger);
    if (atuEnabled && this.configLoader.config.advancedTools.searchTool != null) {
      if (this.configLoader.config.advancedTools.searchTool === 'regex') {
        serverTools.push({ name: 'tool_search_tool_regex', type: 'tool_search_tool_regex_20251119' } satisfies BetaToolSearchToolRegex20251119);
      } else {
        serverTools.push({ name: 'tool_search_tool_bm25', type: 'tool_search_tool_bm25_20251119' } satisfies BetaToolSearchToolBm25_20251119);
      }
    }

    const identityBase = this.#identityBody != null && this.#identityBody.length > 0 ? [`<system-identity>\n${this.#identityBody}\n</system-identity>`] : [];
    // The request-building path (RequestBuilder.buildRequestParams) converts this list to wire
    // tools itself; it does not consult ToolRegistry.wireTools. So the disabled filter has to be
    // applied here, live off configLoader, or a disabled tool still reaches the model.
    const disabledTools = new Set(this.configLoader.config.disabledTools);
    const tools = this.appTools.tools.filter((t) => !disabledTools.has(t.name));
    return {
      model: this.getEffectiveModel(),
      maxTokens: this.configLoader.config.maxTokens,
      thinking: this.getEffectiveThinkingEnabled(),
      thinkingEffort: this.getEffectiveEffort(),
      systemPrompts: [...identityBase, ...this.#resolvedSystemPrompts],
      tools,
      serverTools,
      transformTool: withPathNote(buildAtuTransform(tools, this.configLoader.config.advancedTools), PATH_NOTE),
      betas: {
        [AnthropicBeta.ClaudeCodeAuth]: true,
        [AnthropicBeta.ContextManagement]: false,
        [AnthropicBeta.PromptCachingScope]: false,
        [AnthropicBeta.AdvancedToolUse]: atuEnabled,
      },
      compact: {
        ...this.configLoader.config.compact,
        customInstructions: this.configLoader.config.compact.customInstructions ?? undefined,
      },
      requireToolApproval: true,
      cacheTtl: CacheTtl.OneHour,
    };
  }
}
