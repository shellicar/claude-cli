import { resolve } from 'node:path';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { conditionImage } from '@shellicar/claude-core/image/conditionImage';
import { SipsBridge } from '@shellicar/claude-core/image/SipsBridge';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IModelCatalog } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { detectMediaType } from '../clipboard.js';
import { AttachmentSource } from '../model/AttachmentSource.js';
import { ICommandModeState } from '../model/CommandModeState.js';
import { editorText } from '../model/EditorContent.js';
import { ModelSettings } from '../model/ModelSettings.js';
import { IPrimaryViewState } from '../model/PrimaryViewState.js';
import { StatusState } from '../model/StatusState.js';
import { IWorkingDirectory } from '../model/WorkingDirectory.js';
import { ICacheWarning } from '../setup/CacheWarning.js';
import { IConversationSwitcher } from '../setup/ConversationSwitcher.js';

export type CommandIntent = 'pasteText' | 'pasteFile' | 'pasteImage' | 'removeAttachment' | 'togglePreview' | 'newSession' | 'selectPrev' | 'selectNext' | 'enterModelSubMode' | 'cycleThinking' | 'cycleEffort' | 'openModelEditor' | 'submitModel' | 'enterCdSubMode' | 'openCdEditor' | 'submitCd';

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
  @dependsOn(ICommandModeState) private readonly commandModeState!: ICommandModeState;
  @dependsOn(AttachmentSource) private readonly source!: AttachmentSource;
  @dependsOn(ModelSettings) private readonly modelSettings!: ModelSettings;
  @dependsOn(SipsBridge) private readonly sips!: SipsBridge;
  @dependsOn(ILogger) private readonly logger!: ILogger;
  @dependsOn(StatusState) private readonly statusState!: StatusState;
  @dependsOn(IConversationSwitcher) private readonly switcher!: IConversationSwitcher;
  @dependsOn(IPrimaryViewState) private readonly primaryViewState!: IPrimaryViewState;
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(IWorkingDirectory) private readonly workingDirectory!: IWorkingDirectory;
  @dependsOn(IModelCatalog) private readonly modelCatalog!: IModelCatalog;
  @dependsOn(ICacheWarning) private readonly cacheWarning!: ICacheWarning;

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
          // Refused while a turn is running, for the reason switching is: the turn belongs to the
          // conversation being left, and moving out from under it strands its output. The command row
          // shows the option greyed while that holds, so the key reads as unavailable rather than
          // ignored.
          if (this.primaryViewState.phase !== 'editor') {
            return;
          }
          return await this.switcher.createNew();
        case 'selectPrev':
          this.commandModeState.selectLeft();
          return;
        case 'selectNext':
          this.commandModeState.selectRight();
          return;
        case 'enterModelSubMode':
          this.commandModeState.enterModelSubMode();
          return;
        // Each of these three moves a parameter the prompt cache keys on, so each is followed by a
        // fresh reading of what sending under the new value would cost. The change itself is free:
        // nothing is spent until a request goes out, and cycling back clears the warning.
        case 'cycleThinking':
          this.modelSettings.cycleThinking();
          this.cacheWarning.refresh();
          return;
        case 'cycleEffort':
          this.modelSettings.cycleEffort();
          this.cacheWarning.refresh();
          return;
        case 'openModelEditor':
          this.commandModeState.openModelEditor(this.statusState.model);
          await this.#loadModelCatalogue();
          return;
        case 'submitModel':
          this.#submitModel();
          return;
        case 'enterCdSubMode':
          this.commandModeState.enterCdSubMode();
          return;
        case 'openCdEditor':
          this.commandModeState.openCdEditor(this.fs.cwd());
          return;
        case 'submitCd':
          this.#submitCd();
          return;
      }
    } catch {
      // Fire-and-forget: a failed clipboard read leaves state untouched.
    }
  }

  /**
   * Attempt the move to the typed path. The chdir is the only authoritative
   * check: success closes the editor back to the cd sub-menu; failure keeps it
   * open and shows the reason. The follow-on reloads ride the change event.
   */
  #submitCd(): void {
    const editor = this.commandModeState.cdEditor;
    if (editor == null) {
      return;
    }
    const result = this.workingDirectory.change(editorText(editor));
    if (result.ok) {
      this.commandModeState.closeCdEditor();
    } else {
      this.commandModeState.setCdError(result.message);
    }
  }

  /**
   * Set or clear the model override from the editor buffer. Empty clears it
   * (back to the config model); any other text sets it verbatim. Always
   * succeeds — the typed model is never validated against the catalogue, so an
   * arbitrary or just-released model always sends. Closes the editor back to
   * the model sub-mode.
   */
  #submitModel(): void {
    const editor = this.commandModeState.modelEditor;
    if (editor == null) {
      return;
    }
    const text = editorText(editor).trim();
    this.modelSettings.setModel(text.length > 0 ? text : null);
    this.cacheWarning.refresh();
    this.commandModeState.closeModelEditor();
  }

  /**
   * Lazy-load the model catalogue and hand the ids to the command-mode state so
   * the editor can blue-highlight a known model. Advisory only: an empty list
   * (offline/error) leaves the editor fully usable with no highlight.
   */
  async #loadModelCatalogue(): Promise<void> {
    const models = await this.modelCatalog.list();
    this.commandModeState.setKnownModels(new Set(models.map((m) => m.id)));
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
