import { renderCommandMode } from './renderCommandMode.js';
import { blockTimestamps, buildDivider, renderConversation } from './renderConversation.js';
import { renderEditor } from './renderEditor.js';
import { renderClock, renderModel, renderStatus } from './renderStatus.js';
import { renderToolApproval } from './renderToolApproval.js';
import { renderViewBar } from './renderViewBar.js';
import type { View, ViewModel } from './View.js';

/**
 * The conversation render surface: streaming display, editor region (in editor
 * phase), tool-approval rows, command-mode rows. The render half of
 * PrimaryPresentation. A future history view is another View under another
 * presentation; adding it does not touch this file.
 */
export class PrimaryView implements View {
  public render(model: ViewModel): string[] {
    const { conversationState, editorState, toolApprovalState, commandModeState, statusState, turnClock, terminalState, primaryViewState, appModeState, session, configLoader } = model;
    const cols = terminalState.cols;
    const rows = terminalState.rows;

    const { approvalRow, expandedRows: toolRows } = renderToolApproval(toolApprovalState, cols, Math.floor(rows / 2));
    const { commandRow, previewRows } = renderCommandMode(commandModeState, session.id, cols, Math.max(1, Math.floor(rows / 3)), Math.floor(rows / 2));
    const expandedRows = [...toolRows, ...previewRows];
    const statusBarHeight = 6 + expandedRows.length;
    const contentRows = Math.max(2, rows - statusBarHeight);

    const allContent = renderConversation(conversationState, cols, configLoader.config.markdown);
    if (primaryViewState.phase === 'editor') {
      allContent.push(buildDivider('prompt', cols, blockTimestamps(conversationState.promptStartedAt ?? undefined, undefined)));
      allContent.push('');
      allContent.push(...renderEditor(editorState, cols));
    }

    const overflow = allContent.length - contentRows;
    const visibleRows = overflow > 0 ? allContent.slice(overflow) : [...new Array<string>(contentRows - allContent.length).fill(''), ...allContent];

    const separator = buildDivider(null, cols);
    const modelLine = renderModel(statusState, cols, session.id);
    const statusLine = renderStatus(statusState, cols, session.turnCount);
    const clockLine = renderClock(turnClock.snapshot());
    const viewBar = renderViewBar(appModeState.active);
    // The view bar shares the command-mode row (existing footer chrome, not a
    // new row): it fills the row when no command hint is present. How the two
    // share the row when both are present is the deferred layout call.
    return [...visibleRows, separator, modelLine, statusLine, clockLine, approvalRow, commandRow || viewBar, ...expandedRows];
  }
}
