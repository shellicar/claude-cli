import type { ScrollState } from '../model/ScrollState.js';
import { renderCommandMode } from './renderCommandMode.js';
import { blockTimestamps, buildDivider, renderConversation } from './renderConversation.js';
import { renderEditor } from './renderEditor.js';
import { renderClock, renderModel, renderStatus } from './renderStatus.js';
import { renderToolApproval } from './renderToolApproval.js';
import { renderViewBar } from './renderViewBar.js';
import type { View, ViewModel } from './View.js';

/**
 * Window the transcript into the scroll region for this frame. Reconciles the
 * scroll offset against the current geometry (measure), then slices. At offset 0
 * the tail is shown (pinned to the bottom, the default). When scrolled, the
 * bottom row of the window becomes the indicator divider — it reports how many
 * lines sit below and how to get back, and only appears while offset > 0.
 */
function windowTranscript(transcript: readonly string[], scrollRows: number, cols: number, scrollState: ScrollState): string[] {
  const total = transcript.length;
  scrollState.measure(total, scrollRows, cols);

  if (total <= scrollRows) {
    return [...new Array<string>(scrollRows - total).fill(''), ...transcript];
  }

  const offset = scrollState.offset;
  const bottom = total - offset; // exclusive; offset <= total - scrollRows, so top >= 0
  const window = transcript.slice(bottom - scrollRows, bottom);
  if (offset > 0) {
    window[window.length - 1] = buildDivider(`\u25bc ${offset} below \u00b7 scroll down to resume`, cols);
  }
  return window;
}

/**
 * The conversation render surface: streaming display, editor region (in editor
 * phase), tool-approval rows, command-mode rows. The render half of
 * PrimaryPresentation. A future history view is another View under another
 * presentation; adding it does not touch this file.
 *
 * Only the transcript scrolls. The editor region and the whole status bar are
 * pinned below it, so a scroll-back for copy/paste leaves the composer live and
 * the chrome fixed.
 */
export class PrimaryView implements View {
  public render(model: ViewModel): string[] {
    const { conversationState, editorState, toolApprovalState, commandModeState, statusState, turnClock, terminalState, primaryViewState, scrollState, appModeState, session, configLoader } = model;
    const cols = terminalState.cols;
    const rows = terminalState.rows;

    const { approvalRow, expandedRows: toolRows } = renderToolApproval(toolApprovalState, cols, Math.floor(rows / 2));
    const { commandRow, editorRows, previewRows } = renderCommandMode(commandModeState, session.id, cols, Math.max(1, Math.floor(rows / 3)), Math.floor(rows / 2));
    const expandedRows = [...toolRows, ...previewRows];
    // editorRows (the cd path editor) sit above the command row; both add to the fixed footer height.
    const statusBarHeight = 6 + editorRows.length + expandedRows.length;

    // The prompt editor region is pinned above the status bar, not scrolled, so
    // the transcript can be scrolled back while the composer stays put and live.
    const editorRegion: string[] = [];
    if (primaryViewState.phase === 'editor') {
      editorRegion.push(buildDivider('prompt', cols, blockTimestamps(conversationState.promptStartedAt ?? undefined, undefined)));
      editorRegion.push('');
      editorRegion.push(...renderEditor(editorState, cols));
    }

    const transcript = renderConversation(conversationState, cols, configLoader.config.markdown);
    const scrollRows = Math.max(2, rows - statusBarHeight - editorRegion.length);
    const visibleRows = windowTranscript(transcript, scrollRows, cols, scrollState);

    const separator = buildDivider(null, cols);
    const modelLine = renderModel(statusState, cols, session.id);
    const statusLine = renderStatus(statusState, cols, session.turnCount);
    const clockLine = renderClock(turnClock.snapshot());
    const viewBar = renderViewBar(appModeState.active);
    // The view bar shares the command-mode row (existing footer chrome, not a
    // new row): it fills the row when no command hint is present. How the two
    // share the row when both are present is the deferred layout call.
    return [...visibleRows, ...editorRegion, separator, modelLine, statusLine, clockLine, approvalRow, ...editorRows, commandRow || viewBar, ...expandedRows];
  }
}
