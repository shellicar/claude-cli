import { resolve } from 'node:path';
import { conditionImage } from '@shellicar/claude-core/image/conditionImage';
import { SipsBridge } from '@shellicar/claude-core/image/SipsBridge';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { dependsOn } from '@shellicar/core-di-lite';
import { detectMediaType } from '../clipboard.js';
import { AttachmentSource } from '../model/AttachmentSource.js';
import { CommandModeState } from '../model/CommandModeState.js';
import { ConversationSession } from '../model/ConversationSession.js';
import { ConversationState } from '../model/ConversationState.js';
import { ISystemIdentity } from '../model/ISystemIdentity.js';
import { ModelSettings } from '../model/ModelSettings.js';
import { ITap } from '../tap/ITap.js';

export type CommandIntent = 'pasteText' | 'pasteFile' | 'pasteImage' | 'removeAttachment' | 'togglePreview' | 'newSession' | 'selectPrev' | 'selectNext' | 'enterModelSubMode' | 'cycleThinking' | 'cycleEffort';

/** Deliberate-path test for the missing-file chip (was AppLayout.isLikelyPath). */
function isLikelyPath(s: string): boolean {
  if (!s || s.length > 1024) {
    return false;
  }
  if (/[\n\r]/.test(s)) {
    return false;
  }
  return s.startsWith('/') || s.startsWith('~/') || s === '~' || s.startsWith('./') || s.startsWith('../');
}

/**
 * Executes a recognised CommandIntent. Reads I/O through the injected
 * AttachmentSource; lands every result in a store. Fire-and-forget from the
 * keypress loop: the store mutation emits change, which drives the re-render.
 * I/O errors are swallowed (the clipboard helpers reject when a source is empty
 * or unavailable); on error nothing mutates and no repaint is needed.
 */
export class CommandIntentExecutor {
  @dependsOn(CommandModeState) private readonly commandModeState!: CommandModeState;
  @dependsOn(ConversationState) private readonly conversationState!: ConversationState;
  @dependsOn(ConversationSession) private readonly session!: ConversationSession;
  @dependsOn(AttachmentSource) private readonly source!: AttachmentSource;
  @dependsOn(ModelSettings) private readonly modelSettings!: ModelSettings;
  @dependsOn(SipsBridge) private readonly sips!: SipsBridge;
  @dependsOn(ILogger) private readonly logger!: ILogger;
  @dependsOn(ISystemIdentity) private readonly systemIdentity!: ISystemIdentity;
  @dependsOn(ITap) private readonly tap!: ITap;

  public async execute(intent: CommandIntent): Promise<void> {
    try {
      switch (intent) {
        case 'pasteText':
          return await this.#pasteText();
        case 'pasteFile':
          return await this.#pasteFile();
        case 'pasteImage':
          return await this.#pasteImage();
        case 'removeAttachment':
          this.commandModeState.removeSelected();
          return;
        case 'togglePreview':
          this.commandModeState.togglePreview();
          return;
        case 'newSession':
          await this.session.createNew();
          // A run is process + conversation, so switching conversation ends the old run and starts a new
          // one on the new subject immediately — not at the next turn, or the new conversation stays
          // undiscovered on the dashboard while the user sits idle. No-op when the tap is disabled.
          this.tap.switchConversation(this.session.id);
          this.systemIdentity.inherit(this.session.id);
          this.conversationState.clear();
          return;
        case 'selectPrev':
          this.commandModeState.selectLeft();
          return;
        case 'selectNext':
          this.commandModeState.selectRight();
          return;
        case 'enterModelSubMode':
          this.commandModeState.enterModelSubMode();
          return;
        case 'cycleThinking':
          this.modelSettings.cycleThinking();
          return;
        case 'cycleEffort':
          this.modelSettings.cycleEffort();
          return;
      }
    } catch {
      // Fire-and-forget: a failed clipboard read leaves state untouched.
    }
  }

  async #pasteText(): Promise<void> {
    const text = await this.source.readText();
    if (text) {
      this.commandModeState.addText(text);
    }
  }

  async #pasteFile(): Promise<void> {
    const pathText = (await this.source.readPath())?.trim();
    if (!pathText) {
      return;
    }
    const expanded = pathText.replace(/^~(?=\/|$)/, process.env.HOME ?? '');
    const resolved = resolve(expanded);
    const info = await this.source.stat(resolved);
    if (info === null) {
      if (isLikelyPath(pathText)) {
        this.commandModeState.addFile(resolved, 'missing');
      }
      return;
    }
    if (info.isDirectory) {
      this.commandModeState.addFile(resolved, 'dir');
    } else {
      this.commandModeState.addFile(resolved, 'file', info.size);
    }
  }

  async #pasteImage(): Promise<void> {
    const result = await this.source.readImage();
    if (result.kind === 'image') {
      const mediaType = detectMediaType(result.data);
      if (mediaType) {
        const conditioned = await conditionImage(result.data, mediaType, this.sips, this.logger);
        this.commandModeState.addImage(conditioned.data, conditioned.mediaType);
      }
    }
  }
}
