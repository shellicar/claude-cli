import type { BetaToolSearchToolBm25_20251119, BetaToolSearchToolRegex20251119 } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { AnthropicBeta, type BetaToolUnion, CacheTtl, type DurableConfig } from '@shellicar/claude-sdk';
import { buildAtuTransform } from '../buildAtuTransform.js';
import { buildServerTools } from '../buildServerTools.js';
import { composeSystemPrompts } from '../composeSystemPrompts.js';
import { logger } from '../logger.js';
import type { SystemPromptLoader } from '../SystemPromptLoader.js';
import type { AppToolsService } from './AppToolsService.js';
import type { ModelOverrides } from './ModelOverrides.js';

export class DurableConfigFactory {
  public readonly config: DurableConfig;
  readonly #configLoader: ConfigLoader<any>;
  readonly #overrides: ModelOverrides;
  readonly #appTools: AppToolsService;
  readonly #systemPromptLoader: SystemPromptLoader;
  readonly #systemFlagText: string | null;
  #resolvedSystemPrompts: string[] = [];
  #systemPromptSessionId: string | null = null;

  public constructor(configLoader: ConfigLoader<any>, overrides: ModelOverrides, appTools: AppToolsService, systemPromptLoader: SystemPromptLoader, systemFlagText: string | null) {
    this.#configLoader = configLoader;
    this.#overrides = overrides;
    this.#appTools = appTools;
    this.#systemPromptLoader = systemPromptLoader;
    this.#systemFlagText = systemFlagText;
    this.config = this.#build();
  }

  /**
   * Reads the SYSTEM.md sources and composes them with the config inline text
   * and the --system flag into the system-prompt blocks. Async file I/O, so it
   * is activation: called at startup and again when the session changes.
   */
  public async resolveSystemPromptsFor(sessionId: string): Promise<void> {
    const cfg = this.#configLoader.config.systemPrompt;
    const fileSections = cfg.enabled ? await this.#systemPromptLoader.getSections(cfg.sources) : [];
    this.#resolvedSystemPrompts = composeSystemPrompts({ fileSections, configText: cfg.text, flagText: this.#systemFlagText });
    this.#systemPromptSessionId = sessionId;
  }

  public needsSystemPromptResolve(sessionId: string): boolean {
    return this.#systemPromptSessionId !== sessionId;
  }

  public getEffectiveModel(): string {
    return this.#overrides.model ?? this.#configLoader.config.model;
  }

  public getEffectiveThinkingEnabled(): boolean {
    const t = this.#overrides.thinking;
    if (t === 'on') {
      return true;
    }
    if (t === 'off') {
      return false;
    }
    return this.#configLoader.config.thinking.enabled;
  }

  public getEffectiveEffort() {
    return this.#overrides.effort ?? this.#configLoader.config.thinking.effort;
  }

  /**
   * Mutates `this.config` in place with current values. Call before each
   * turn so `QueryRunner` and `AgentMessageHandler` (which hold the same
   * reference) see updated values without re-injection.
   */
  public update(claudeMdContent?: string | null): void {
    Object.assign(this.config, this.#build());
    this.config.cachedReminders = claudeMdContent != null ? [claudeMdContent] : undefined;
  }

  #build(): DurableConfig {
    const atuEnabled = this.#configLoader.config.advancedTools.enabled;
    const serverTools: BetaToolUnion[] = buildServerTools(this.#configLoader.config.serverTools, this.#configLoader.config.advancedTools.codeExecutionTool, logger);
    if (atuEnabled && this.#configLoader.config.advancedTools.searchTool != null) {
      if (this.#configLoader.config.advancedTools.searchTool === 'regex') {
        serverTools.push({ name: 'tool_search_tool_regex', type: 'tool_search_tool_regex_20251119' } satisfies BetaToolSearchToolRegex20251119);
      } else {
        serverTools.push({ name: 'tool_search_tool_bm25', type: 'tool_search_tool_bm25_20251119' } satisfies BetaToolSearchToolBm25_20251119);
      }
    }

    return {
      model: this.getEffectiveModel(),
      maxTokens: this.#configLoader.config.maxTokens,
      thinking: this.getEffectiveThinkingEnabled(),
      thinkingEffort: this.getEffectiveEffort(),
      systemPrompts: this.#resolvedSystemPrompts,
      tools: this.#appTools.tools,
      serverTools,
      transformTool: buildAtuTransform(this.#appTools.tools, this.#configLoader.config.advancedTools),
      betas: {
        [AnthropicBeta.ClaudeCodeAuth]: true,
        [AnthropicBeta.ContextManagement]: false,
        [AnthropicBeta.PromptCachingScope]: false,
        [AnthropicBeta.AdvancedToolUse]: atuEnabled,
      },
      compact: {
        ...this.#configLoader.config.compact,
        customInstructions: this.#configLoader.config.compact.customInstructions ?? undefined,
      },
      requireToolApproval: true,
      cacheTtl: CacheTtl.OneHour,
    };
  }
}
