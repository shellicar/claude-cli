import type { Clock } from '@js-joda/core';
import type { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import type { sdkConfigSchema } from '../cli-config/schema.js';
import type { IAppModeState } from '../model/AppModeState.js';
import type { ICommandModeState } from '../model/CommandModeState.js';
import type { IConversationListState } from '../model/ConversationListState.js';
import type { IConversationSession } from '../model/ConversationSession.js';
import type { IConversationState } from '../model/ConversationState.js';
import type { IEditorState } from '../model/EditorState.js';
import type { IHistoryViewState } from '../model/HistoryViewState.js';
import type { ITurnClock } from '../model/ITurnClock.js';
import type { IPrimaryViewState } from '../model/PrimaryViewState.js';
import type { IScrollState } from '../model/ScrollState.js';
import type { StatusState } from '../model/StatusState.js';
import type { ITerminalState } from '../model/TerminalState.js';
import type { IToolApprovalState } from '../model/ToolApprovalState.js';
import type { IConversationSwitcher } from '../setup/ConversationSwitcher.js';

/**
 * The shared model bag every view reads from. A view picks the stores it
 * needs; a peer view that needs new state adds a store here and existing
 * views are unaffected because they read only what they reference.
 *
 * `primaryViewState` carries the primary's editor/streaming phase (PrimaryView
 * shows its editor region only in editor phase); `session` is a stable
 * reference (the command renderer needs its id). All sizing comes from
 * `terminalState`; a view never sees a Screen. `historyViewState` carries the history outline's navigation state.
 * `appModeState` (which presentation is active) is in the bag because the
 * footer view bar marks the active view in every view; ViewHost still owns the
 * switch itself.
 */
export type ViewModel = {
  conversationState: IConversationState;
  editorState: IEditorState;
  toolApprovalState: IToolApprovalState;
  commandModeState: ICommandModeState;
  statusState: StatusState;
  turnClock: ITurnClock;
  terminalState: ITerminalState;
  primaryViewState: IPrimaryViewState;
  scrollState: IScrollState;
  historyViewState: IHistoryViewState;
  conversationListState: IConversationListState;
  appModeState: IAppModeState;
  session: IConversationSession;
  /** Read for one thing: whether a conversation move is in flight, so an option that would be refused
   *  is shown as unavailable. */
  conversationSwitcher: IConversationSwitcher;
  configLoader: ConfigLoader<typeof sdkConfigSchema>;
  /** Wall-clock, injected rather than read from the system, so a view that shows an age is provable. */
  clock: Clock;
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
