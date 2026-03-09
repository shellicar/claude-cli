import { appendFileSync, type FSWatcher, readFileSync, statSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AppState } from './AppState.js';
import { AttachmentStore } from './AttachmentStore.js';
import { AuditWriter } from './AuditWriter.js';
import { CommandMode } from './CommandMode.js';
import { CONFIG_PATH } from './cli-config/consts.js';
import { diffConfig } from './cli-config/diffConfig.js';
import { loadCliConfig } from './cli-config/loadCliConfig.js';
import type { ResolvedCliConfig } from './cli-config/types.js';
import { validateRawConfig } from './cli-config/validateRawConfig.js';
import { readClipboardImage, readClipboardText, truncateText } from './clipboard.js';
import { getConfig, isInsideCwd, updateConfig } from './config.js';
import { formatDiff } from './diff.js';
import { backspace, clear, createEditor, deleteChar, deleteWord, deleteWordBackward, type EditorState, getText, insertChar, insertNewline, moveBufferEnd, moveBufferStart, moveDown, moveEnd, moveHome, moveLeft, moveRight, moveUp, moveWordLeft, moveWordRight } from './editor.js';
import { discoverSkills, initFiles } from './files.js';
import { printHelp, printVersionInfo } from './help.js';
import { type KeyAction, setupKeypressHandler } from './input.js';
import { PermissionManager } from './PermissionManager.js';
import { type AskQuestion, PromptManager } from './PromptManager.js';
import { detectPlatform, type Platform } from './platform.js';
import { GitProvider } from './providers/GitProvider.js';
import { UsageProvider } from './providers/UsageProvider.js';
import { SdkResult } from './SdkResult.js';
import { SessionManager } from './SessionManager.js';
import { SystemPromptBuilder } from './SystemPromptBuilder.js';
import { QuerySession } from './session.js';
import { Terminal } from './terminal.js';
import { type ContextUsage, UsageTracker } from './UsageTracker.js';

export class ClaudeCli {
  private readonly appState = new AppState();
  private readonly usage = new UsageTracker();
  private readonly promptBuilder = new SystemPromptBuilder();
  private readonly commandMode = new CommandMode();
  private editor: EditorState = createEditor();
  private readonly attachmentStore = new AttachmentStore();
  private platform: Platform = 'unknown';

  private cliConfig!: ResolvedCliConfig;
  private term!: Terminal;
  private session!: QuerySession;
  private audit!: AuditWriter;
  private permissions!: PermissionManager;
  private prompts!: PromptManager;
  private sessions!: SessionManager;

  private cleanupKeypress: (() => void) | undefined;
  private readonly redrawCallback = () => this.redraw();
  private resizeTimer: ReturnType<typeof setTimeout> | undefined;
  private redrawScheduled = false;
  private savedEditor: EditorState | undefined;
  private configWatcher: FSWatcher | undefined;
  private configDebounce: ReturnType<typeof setTimeout> | undefined;
  private pendingConfigReload = false;

  private contextColor(percent: number): string {
    return percent > 80 ? '\x1b[31m' : percent > 50 ? '\x1b[33m' : '\x1b[32m';
  }

  private checkConfigReload(): void {
    if (this.appState.phase !== 'idle') {
      this.pendingConfigReload = true;
      return;
    }
    this.pendingConfigReload = false;
    const { config: newConfig, warnings } = loadCliConfig();

    try {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      for (const w of validateRawConfig(raw)) {
        this.term.info(`\x1b[33mconfig warning: ${w}\x1b[0m`);
      }
    } catch {
      // parse error already covered by loadCliConfig warnings
    }

    for (const w of warnings) {
      this.term.info(`\x1b[33mconfig warning: ${w}\x1b[0m`);
    }

    const changes = diffConfig(this.cliConfig, newConfig);
    if (changes.length === 0) {
      return;
    }

    for (const change of changes) {
      this.term.info(`\x1b[36m[config] ${change}\x1b[0m`);
    }

    const prev = this.cliConfig;
    this.cliConfig = newConfig;

    this.session.updateConfig(newConfig.model, newConfig.maxTurns, newConfig.thinking, newConfig.thinkingEffort);
    this.permissions.updateConfig(newConfig.permissionTimeoutMs, newConfig.extendedPermissionTimeoutMs, newConfig.drowningThreshold);
    this.prompts.updateConfig(newConfig.questionTimeoutMs);
    this.term.updateConfig(newConfig.drowningThreshold);
    updateConfig({ autoApproveEdits: newConfig.autoApproveEdits, autoApproveReads: newConfig.autoApproveReads });

    const providersChanged = JSON.stringify(prev.providers) !== JSON.stringify(newConfig.providers);
    if (providersChanged) {
      this.promptBuilder.clear();
      if (newConfig.providers.usage.enabled) {
        this.promptBuilder.add(new UsageProvider(this.usage, newConfig.providers.usage));
      }
      if (newConfig.providers.git.enabled) {
        this.promptBuilder.add(new GitProvider(newConfig.providers.git));
      }
    }
  }

  private contextPercent(): number {
    return this.usage.context ? Math.round(this.usage.context.percent) : 0;
  }

  private toolsDisabled(): boolean {
    return this.contextPercent() >= 85;
  }

  private toolsRemoved(): boolean {
    return this.contextPercent() >= 90;
  }

  private formatContext(ctx: ContextUsage): string {
    const color = this.contextColor(ctx.percent);
    return `${color}context: ${ctx.used.toLocaleString()}/${ctx.window.toLocaleString()} (${ctx.percent.toFixed(1)}%)\x1b[0m`;
  }

  private handleCommand(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed === '/quit' || trimmed === '/exit') {
      this.cleanup();
      this.term.info('Goodbye.');
      process.exit(0);
    }
    if (trimmed === '/version') {
      printVersionInfo((msg) => this.term.info(msg));
      return true;
    }
    if (trimmed === '/help') {
      printHelp((msg) => this.term.info(msg));
      return true;
    }
    if (trimmed === '/config') {
      for (const [key, value] of Object.entries(this.cliConfig)) {
        this.term.info(`  ${key}: ${value}`);
      }
      return true;
    }
    if (trimmed === '/session' || trimmed.startsWith('/session ')) {
      const arg = trimmed.slice('/session'.length).trim();
      if (arg) {
        this.session.setSessionId(arg);
        this.term.sessionId = arg;
        this.term.info(`Switched to session: ${arg}`);
      } else {
        this.term.info(`Session: ${this.session.currentSessionId ?? 'none'}`);
      }
      return true;
    }
    if (trimmed.startsWith('/compact-at ')) {
      const uuid = trimmed.slice('/compact-at '.length).trim();
      if (!uuid) {
        this.term.info('Usage: /compact-at <message-uuid>');
        return true;
      }
      this.term.info(`Compacting at: ${uuid}`);
      this.session.setResumeAt(uuid);
      this.submit('/compact');
      return true;
    }
    if (trimmed === '/add-dir' || trimmed.startsWith('/add-dir ')) {
      const arg = trimmed.slice('/add-dir'.length).trim();
      if (!arg) {
        this.term.info('Usage: /add-dir <path>');
        const dirs = this.session.getAdditionalDirectories();
        if (dirs.length > 0) {
          this.term.info('Current additional directories:');
          for (const d of dirs) {
            this.term.info(`  ${d}`);
          }
        }
        return true;
      }
      const expanded = this.cliConfig.expandTilde && arg.startsWith('~/') ? arg.replace('~', homedir()) : arg;
      const resolved = resolve(expanded);
      try {
        if (!statSync(resolved).isDirectory()) {
          this.term.error(`Not a directory: ${resolved}`);
          return true;
        }
      } catch {
        this.term.error(`Directory not found: ${resolved}`);
        return true;
      }
      const cwd = process.cwd();
      const allDirs = [cwd, ...this.session.getAdditionalDirectories()];
      const parent = allDirs.find((d) => resolved === d || resolved.startsWith(`${d}/`));
      if (parent) {
        this.term.info(`${resolved} is already accessible within ${parent}`);
        return true;
      }
      this.session.addDirectory(resolved);
      this.term.info(`Added directory: ${resolved}`);
      return true;
    }
    return false;
  }

  private async submit(override?: string): Promise<void> {
    const text = override ?? getText(this.editor);
    if (!text.trim()) {
      return;
    }

    const attachments = this.attachmentStore.takeAttachments();
    this.commandMode.exit();

    this.editor = clear(this.editor);
    if (attachments) {
      this.term.log(`> ${text} [${attachments.length} attachment${attachments.length === 1 ? '' : 's'}]`);
    } else {
      this.term.log(`> ${text}`);
    }

    if (this.handleCommand(text)) {
      this.redraw();
      return;
    }

    const startTime = Date.now();
    this.term.log('Sending query...');
    this.appState.sending();

    let firstMessage = true;
    const onMessage = (msg: SDKMessage): void => {
      if (firstMessage) {
        firstMessage = false;
        this.appState.thinking();
      }
      this.audit.write(msg);
      this.usage.onMessage(msg);
      if (msg.type === 'assistant' || msg.type === 'result') {
        this.term.log(`\x1b[2m[${msg.type} received at ${new Date().toISOString()}]\x1b[0m`);
      }

      switch (msg.type) {
        case 'system':
          if (msg.subtype === 'init') {
            this.term.log(`session: ${msg.session_id} model: ${msg.model}`);
          } else {
            this.term.log(`system: ${msg.subtype}`);
          }
          break;
        case 'assistant': {
          const ctx = this.usage.context;
          const pctSuffix = ctx ? ` ${this.contextColor(ctx.percent)}(${ctx.percent.toFixed(1)}%)\x1b[0m` : '';
          this.term.log(`\x1b[2mmessageId: ${msg.uuid}\x1b[0m${pctSuffix}`);
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              this.term.log(`\x1b[1;97massistant: ${block.text}\x1b[0m`);
            } else if (block.type === 'tool_use') {
              if (block.name === 'Edit') {
                const input = block.input as { file_path?: string; old_string?: string; new_string?: string };
                this.term.log(`tool_use: Edit ${input.file_path ?? 'unknown'}`);
                if (input.old_string && input.new_string) {
                  this.term.info(formatDiff(input.file_path ?? 'unknown', input.old_string, input.new_string));
                }
              } else if (block.name === 'ExitPlanMode') {
                const input = block.input as { plan?: string };
                this.term.log('tool_use: ExitPlanMode');
                if (input.plan) {
                  this.term.info(input.plan);
                }
              } else {
                this.term.log(`tool_use: ${block.name}`, block.input);
              }
              // AskUserQuestion has its own key handling in PromptManager — don't enqueue as a permission.
              if (block.name !== 'AskUserQuestion') {
                this.permissions.enqueue(block.id, block.name, block.input as Record<string, unknown>);
              }
            }
          }
          break;
        }
        case 'user': {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (typeof block === 'object' && 'type' in block && block.type === 'tool_result') {
                const result = block as { tool_use_id: string; content?: string; is_error?: boolean };
                this.term.log(`tool_result:${result.is_error ? ' (error)' : ''} ${result.content?.slice(0, 200) ?? ''}`);
                this.permissions.handleResult(result.tool_use_id);
              }
            }
          }
          break;
        }
        case 'result': {
          if (msg.subtype === 'success') {
            const sdkResult = new SdkResult(msg);
            if (sdkResult.isRateLimited) {
              this.term.log(`\x1b[31mresult: RATE LIMITED (${msg.duration_ms}ms) ${msg.result}\x1b[0m`);
            } else if (sdkResult.isApiError) {
              this.term.log(`\x1b[31mresult: API ERROR ${sdkResult.apiError?.statusCode} (${msg.duration_ms}ms) ${sdkResult.apiError?.errorType}: ${sdkResult.apiError?.errorMessage}\x1b[0m`);
            } else if (sdkResult.isError) {
              this.term.log(`\x1b[31mresult: ERROR is_error (${msg.duration_ms}ms) ${msg.result}\x1b[0m`, msg);
            } else if (sdkResult.noTokens) {
              this.term.log(`\x1b[31mresult: ERROR no_tokens (${msg.duration_ms}ms) ${msg.result}\x1b[0m`, msg);
            } else {
              this.term.log(`result: ${msg.subtype} cost=$${msg.total_cost_usd.toFixed(4)} turns=${msg.num_turns} duration=${msg.duration_ms}ms`);
            }
          } else {
            this.term.log(`\x1b[31mresult: ERROR ${msg.subtype} (${msg.duration_ms}ms) ${msg.errors.join(', ')}\x1b[0m`);
          }

          this.usage.onResult(msg);

          for (const [model, mu] of Object.entries(msg.modelUsage)) {
            const shortModel = model.replace(/^claude-/, '');
            const input = (mu.inputTokens ?? 0) + (mu.cacheCreationInputTokens ?? 0) + (mu.cacheReadInputTokens ?? 0);
            const output = mu.outputTokens ?? 0;
            const window = mu.contextWindow ?? 0;
            const pct = window > 0 ? ` (${((input / window) * 100).toFixed(1)}%)` : '';
            this.term.log(`  ${shortModel}: in=${input.toLocaleString()}${window > 0 ? `/${window.toLocaleString()}` : ''}${pct} out=${output.toLocaleString()} $${mu.costUSD.toFixed(4)}`);
            if (mu.cacheReadInputTokens || mu.cacheCreationInputTokens) {
              this.term.log(`    cache: read=${(mu.cacheReadInputTokens ?? 0).toLocaleString()} created=${(mu.cacheCreationInputTokens ?? 0).toLocaleString()} uncached=${(mu.inputTokens ?? 0).toLocaleString()}`);
            }
          }

          const ctx = this.usage.context;
          if (ctx) {
            this.term.log(`  ${this.formatContext(ctx)}`);
          }
          this.term.log(`  session: $${this.usage.sessionCost.toFixed(4)}`);
          break;
        }
        case 'stream_event':
          break;
        default:
          this.term.log(msg.type);
          break;
      }
    };

    try {
      this.redraw();
      const isCompact = text === '/compact';
      if (isCompact) {
        this.session.systemPromptAppend = undefined;
      } else {
        this.session.systemPromptAppend = await this.promptBuilder.build();
        if (this.session.systemPromptAppend) {
          this.term.log('systemPromptAppend: ' + this.session.systemPromptAppend.replaceAll('\n', '\\n'));
        }
      }
      this.session.disableTools = !isCompact && this.toolsDisabled();
      this.session.removeTools = !isCompact && this.toolsRemoved();
      await this.session.send(text, onMessage, attachments, isCompact ? this.cliConfig.compactModel : undefined);
    } catch (err) {
      if (this.session.wasAborted) {
        this.term.log('Aborted');
      } else {
        this.term.log(`Error: ${err}`);
      }
    } finally {
      this.appState.idle();
      if (this.session.currentSessionId) {
        this.sessions.save(this.session.currentSessionId);
        this.term.sessionId = this.session.currentSessionId;
      }
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      this.term.log(`Done after ${elapsed}s`);
      if (this.pendingConfigReload) {
        this.checkConfigReload();
      }
    }
    this.showSkills();
    this.redraw();
  }

  private showSkills(): void {
    const skills = discoverSkills();
    if (skills.length > 0) {
      this.term.log(`skills: ${skills.map((s) => s.name).join(', ')}`);
    }
  }

  private redraw(): void {
    const busy = this.appState.phase !== 'idle';
    const prompt = this.prompts.isOtherMode ? '> ' : this.commandMode.active ? '🔧 ' : busy ? '⏳ ' : '💬 ';
    const hideCursor = (busy && !this.prompts.isOtherMode) || this.commandMode.active;
    this.term.renderEditor(this.editor, prompt, hideCursor);
  }

  private handleKey(key: KeyAction): void {
    switch (key.type) {
      case 'ctrl+c': {
        this.session.cancel();
        this.cleanup();
        process.exit(0);
        break;
      }
      case 'ctrl+/':
        this.commandMode.toggle();
        this.scheduleRedraw();
        return;
      case 'escape':
        if (this.commandMode.active) {
          this.commandMode.exit();
          this.scheduleRedraw();
          return;
        }
        if (this.prompts.isOtherMode) {
          this.prompts.cancelOther();
          this.restoreEditor();
          this.scheduleRedraw();
          return;
        }
        this.term.log('Escape pressed');
        if (this.session.isActive) {
          this.term.log('Aborting query...');
          this.permissions.cancelAll();
          this.prompts.cancelAll();
          this.restoreEditor();
          setTimeout(() => this.session.cancel(), 0);
        }
        return;
    }

    // Command mode consumes keys before permission/prompt handling
    if (this.commandMode.active) {
      const action = this.commandMode.handleKey(key);
      if (action) {
        switch (action.type) {
          case 'paste-image':
            this.pasteImage();
            break;
          case 'paste-text':
            this.pasteText();
            break;
          case 'delete':
            this.attachmentStore.removeSelected();
            this.scheduleRedraw();
            break;
          case 'preview':
            this.commandMode.togglePreview();
            this.scheduleRedraw();
            break;
          case 'select-left':
            this.attachmentStore.selectLeft();
            this.scheduleRedraw();
            break;
          case 'select-right':
            this.attachmentStore.selectRight();
            this.scheduleRedraw();
            break;
          case 'session-clear':
            this.session.clearSessionId();
            this.sessions.clear();
            this.term.sessionId = undefined;
            this.term.log('Session cleared');
            this.commandMode.exit();
            this.scheduleRedraw();
            break;
          case 'exit':
            this.commandMode.exit();
            this.scheduleRedraw();
            break;
          case 'none':
            this.scheduleRedraw();
            break;
        }
      }
      return;
    }

    if (this.permissions.handleKey(key)) {
      return;
    }

    if (this.prompts.handleKey(key)) {
      // Check if we just entered "Other" mode — swap in a fresh editor
      if (this.prompts.isOtherMode && !this.savedEditor) {
        this.savedEditor = this.editor;
        this.editor = createEditor();
        this.scheduleRedraw();
      }
      return;
    }

    // In "Other" mode, the editor is active for typing. Allow editing keys through.
    if (this.session.isActive && !this.prompts.isOtherMode) {
      return;
    }

    switch (key.type) {
      case 'ctrl+d': {
        if (this.prompts.isOtherMode) {
          return;
        }
        this.cleanup();
        this.term.info('Goodbye.');
        process.exit(0);
        break;
      }
      case 'ctrl+enter':
        if (this.prompts.isOtherMode) {
          this.submitOther();
          return;
        }
        this.submit();
        return;
      case 'enter':
        this.editor = insertNewline(this.editor);
        break;
      case 'backspace':
        this.editor = backspace(this.editor);
        break;
      case 'delete':
        this.editor = deleteChar(this.editor);
        break;
      case 'ctrl+delete':
        this.editor = deleteWord(this.editor);
        break;
      case 'ctrl+backspace':
        this.editor = deleteWordBackward(this.editor);
        break;
      case 'left':
        this.editor = moveLeft(this.editor);
        break;
      case 'right':
        this.editor = moveRight(this.editor);
        break;
      case 'up':
        this.editor = moveUp(this.editor);
        break;
      case 'down':
        this.editor = moveDown(this.editor);
        break;
      case 'home':
        this.editor = moveHome(this.editor);
        break;
      case 'end':
        this.editor = moveEnd(this.editor);
        break;
      case 'ctrl+home':
        this.editor = moveBufferStart(this.editor);
        break;
      case 'ctrl+end':
        this.editor = moveBufferEnd(this.editor);
        break;
      case 'ctrl+left':
        this.editor = moveWordLeft(this.editor);
        break;
      case 'ctrl+right':
        this.editor = moveWordRight(this.editor);
        break;
      case 'char':
        this.editor = insertChar(this.editor, key.value);
        break;
      case 'unknown':
        return;
    }

    this.scheduleRedraw();
  }

  private submitOther(): void {
    const text = getText(this.editor).trim();
    if (text) {
      this.restoreEditor();
      this.prompts.submitOther(text);
    }
    this.scheduleRedraw();
  }

  private pasteImage(): void {
    const log = (_msg: string) => {};
    readClipboardImage(this.platform, log)
      .then((clip) => {
        switch (clip.kind) {
          case 'image': {
            const sizeKB = Math.ceil(clip.data.length / 1024);
            const isDuplicate = this.attachmentStore.addImage(clip.data);
            if (isDuplicate) {
              this.term.log(`Image already attached (${sizeKB}KB)`);
            } else {
              this.term.log(`Image attached (${sizeKB}KB, ${this.attachmentStore.attachments.length} total)`);
            }
            this.scheduleRedraw();
            break;
          }
          case 'no-image':
            this.term.beep();
            this.term.log(`Clipboard has ${clip.types.join(', ')} (no image)`);
            break;
          case 'empty':
            this.term.beep();
            this.term.log('Clipboard is empty');
            break;
          case 'unsupported':
            this.term.beep();
            this.term.log('Clipboard image not supported on this platform');
            break;
        }
      })
      .catch((err) => {
        this.term.error(`Clipboard read failed: ${err}`);
      });
  }

  private pasteText(): void {
    readClipboardText(this.platform)
      .then((clip) => {
        switch (clip.kind) {
          case 'text': {
            const { text, truncated } = truncateText(clip.text);
            const sizeKB = Math.ceil(Buffer.byteLength(text) / 1024);
            const isDuplicate = this.attachmentStore.addText(text);
            if (isDuplicate) {
              this.term.log(`Text already attached (${sizeKB}KB)`);
            } else {
              const suffix = truncated ? ', truncated' : '';
              this.term.log(`Text attached (${sizeKB}KB${suffix}, ${this.attachmentStore.attachments.length} total)`);
            }
            this.scheduleRedraw();
            break;
          }
          case 'no-text':
            this.term.beep();
            this.term.log(`Clipboard has ${clip.types.join(', ')} (no text)`);
            break;
          case 'empty':
            this.term.beep();
            this.term.log('Clipboard is empty');
            break;
          case 'unsupported':
            this.term.beep();
            this.term.log('Clipboard text not supported on this platform');
            break;
        }
      })
      .catch((err) => {
        this.term.error(`Clipboard read failed: ${err}`);
      });
  }

  private restoreEditor(): void {
    if (this.savedEditor) {
      this.editor = this.savedEditor;
      this.savedEditor = undefined;
    }
  }

  private scheduleRedraw(): void {
    if (!this.redrawScheduled) {
      this.redrawScheduled = true;
      setImmediate(() => {
        this.redrawScheduled = false;
        this.redraw();
      });
    }
  }

  private cleanup(): void {
    // Pop kitty keyboard protocol — restore previous terminal key reporting
    process.stdout.write('\x1b[<u');
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    this.cleanupKeypress?.();
    this.configWatcher?.close();
    clearTimeout(this.configDebounce);
    process.stdout.removeListener('resize', this.redrawCallback);
    process.stdin.pause();
  }

  public async start(): Promise<void> {
    this.platform = detectPlatform();

    const { config, warnings, path: configPath } = loadCliConfig();
    this.cliConfig = config;

    if (configPath) {
      try {
        const raw = JSON.parse(readFileSync(configPath, 'utf8'));
        for (const w of validateRawConfig(raw)) {
          warnings.push(w);
        }
      } catch {
        // loadCliConfig already handles parse errors
      }
    }

    this.term = new Terminal(this.appState, config.drowningThreshold, this.attachmentStore, this.commandMode);
    this.session = new QuerySession(config.model, config.maxTurns, config.thinking, config.thinkingEffort);

    const paths = initFiles();
    this.audit = new AuditWriter(paths.auditFile);
    this.permissions = new PermissionManager(this.term, this.appState, config.permissionTimeoutMs, config.extendedPermissionTimeoutMs, config.drowningThreshold);
    this.prompts = new PromptManager(this.term, this.appState, config.questionTimeoutMs);
    this.sessions = new SessionManager(paths.sessionFile);

    updateConfig({ autoApproveEdits: config.autoApproveEdits, autoApproveReads: config.autoApproveReads });

    if (config.providers.usage.enabled) {
      this.promptBuilder.add(new UsageProvider(this.usage, config.providers.usage));
    }
    if (config.providers.git.enabled) {
      this.promptBuilder.add(new GitProvider(config.providers.git));
    }

    this.session.canUseTool = (toolName, input, options) => {
      // Guard: if the query is no longer active, deny immediately.
      // This can happen when the SDK calls canUseTool from a task_notification
      // after the original query stream has ended.
      if (!this.session.isActive) {
        this.term.log(`\x1b[33mwarning: canUseTool called while query inactive (${toolName}). Denying.\x1b[0m`);
        return Promise.resolve({ behavior: 'deny' as const, message: 'Query is no longer active' });
      }

      if (this.toolsDisabled()) {
        const percent = this.contextPercent();
        this.term.log(`\x1b[33mtools disabled (context ${percent}% >= 85%): denying ${toolName}\x1b[0m`);
        return Promise.resolve({ behavior: 'deny' as const, message: 'Tools are disabled due to high context usage. Respond with text only.' });
      }

      const config = getConfig();
      const cwd = process.cwd();
      const signal = options?.signal;

      const allow = (updatedInput: Record<string, unknown>) => Promise.resolve({ behavior: 'allow' as const, updatedInput });

      // AskUserQuestion — render and capture selection
      if (toolName === 'AskUserQuestion') {
        const questions = (input as { questions?: AskQuestion[] }).questions;
        if (questions && questions.length > 0) {
          return this.prompts.requestQuestion(questions, input, signal);
        }
      }

      // Auto-approve edits inside cwd
      if (config.autoApproveEdits && (toolName === 'Edit' || toolName === 'Write')) {
        const filePath = (input as { file_path?: string }).file_path;
        if (filePath && isInsideCwd(filePath, cwd)) {
          this.term.log(`auto-approved: ${toolName} ${filePath}`);
          return allow(input);
        }
      }

      return this.permissions.resolve(options?.toolUseID ?? '', input, signal);
    };

    printVersionInfo((msg) => this.term.info(msg));
    if (configPath) {
      this.term.info(`config: ${configPath}`);
    }
    for (const warning of warnings) {
      this.term.info(`\x1b[33mconfig warning: ${warning}\x1b[0m`);
    }
    this.term.info(`platform: ${this.platform}`);
    this.term.info(`cwd: ${process.cwd()}`);
    this.term.info(`audit: ${paths.auditFile}`);
    this.term.info(`session file: ${paths.sessionFile}`);

    const savedSession = this.sessions.load((msg) => this.term.info(msg));
    if (savedSession) {
      this.session.setSessionId(savedSession);
      this.term.sessionId = savedSession;
      this.term.info(`Resuming session: ${savedSession}`);
      this.usage.loadContextFromAudit(paths.auditFile, savedSession);
      const lastAssistant = this.usage.lastAssistant;
      if (lastAssistant) {
        this.term.info(`\x1b[2mlast messageId: ${lastAssistant.uuid}\x1b[0m`);
      }
      const ctx = this.usage.context;
      if (ctx) {
        this.term.info(this.formatContext(ctx));
      }
      await this.usage.loadCostFromAudit(paths.auditFile, savedSession);
      if (this.usage.sessionCost > 0) {
        this.term.info(`session: $${this.usage.sessionCost.toFixed(4)}`);
      }
    } else {
      this.term.info('Starting new session');
    }
    this.term.info('Enter = newline, Ctrl+Enter = send, Ctrl+C = quit');
    this.term.info('Commands: /help, /version, /quit, /exit, /session [id], /compact-at <uuid>, /add-dir <path>');
    this.term.info('---');

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    // Push kitty keyboard protocol (flag 1 = disambiguate) so terminals
    // send CSI u format for ambiguous keys like Ctrl+Enter / Shift+Enter.
    // Unlike xterm modifyOtherKeys, this doesn't break Ctrl+C etc. —
    // it only changes keys that would otherwise be indistinguishable.
    // Terminals that don't support this silently ignore the sequence.
    process.stdout.write('\x1b[>1u');
    process.stdin.resume();
    this.cleanupKeypress = setupKeypressHandler((key) => this.handleKey(key));
    process.stdout.on('resize', () => {
      // biome-ignore lint/suspicious/noConfusingLabels: esbuild dropLabels strips DEBUG blocks in production
      // biome-ignore lint/correctness/noUnusedLabels: esbuild dropLabels strips DEBUG blocks in production
      DEBUG: {
        const ts = new Date().toISOString();
        appendFileSync('/tmp/claude-cli-resize.log', `${ts} | resize ${process.stdout.columns}x${process.stdout.rows}\n`);
      }
      this.term.paused = true;
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.term.paused = false;
        this.redraw();
      }, 300);
    });
    this.appState.on('changed', () => {
      this.term.refresh();
      this.redraw();
    });

    try {
      this.configWatcher = watch(CONFIG_PATH, () => {
        clearTimeout(this.configDebounce);
        this.configDebounce = setTimeout(() => this.checkConfigReload(), 100);
      });
    } catch {
      // Config file might not exist yet
    }

    this.showSkills();
    this.redraw();
  }
}
