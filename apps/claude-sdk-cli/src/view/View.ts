import type { CommandModeState } from '../model/CommandModeState.js';
import type { ConversationSession } from '../model/ConversationSession.js';
import type { ConversationState } from '../model/ConversationState.js';
import type { EditorState } from '../model/EditorState.js';
import type { PrimaryViewState } from '../model/PrimaryViewState.js';
import type { StatusState } from '../model/StatusState.js';
import type { TerminalState } from '../model/TerminalState.js';
import type { ToolApprovalState } from '../model/ToolApprovalState.js';

/**
 * The shared model bag every view reads from. A view picks the stores it
 * needs; a peer view that needs new state adds a store here and existing
 * views are unaffected because they read only what they reference.
 *
 * `primaryViewState` carries the primary's editor/streaming phase (PrimaryView
 * shows its editor region only in editor phase); `session` is a stable
 * reference (the command renderer needs its id). All sizing comes from
 * `terminalState`; a view never sees a Screen. The app mode (which presentation
 * is active) is ViewHost's concern, not a view's, so it is not in this bag.
 */
export type ViewModel = {
  conversationState: ConversationState;
  editorState: EditorState;
  toolApprovalState: ToolApprovalState;
  commandModeState: CommandModeState;
  statusState: StatusState;
  terminalState: TerminalState;
  primaryViewState: PrimaryViewState;
  session: ConversationSession;
};

/**
 * A presentation's render surface. It renders the model to a full frame of rows
 * and does nothing else: no key handling, no I/O, no store mutation. Input
 * handling is a separate concern (see InputHandler) that meets presentation
 * only at the stores in ViewModel.
 */
export interface View {
  render(model: ViewModel): string[];
}
