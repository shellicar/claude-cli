import type { Clock } from '@js-joda/core';
import type { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import type { sdkConfigSchema } from '../cli-config/schema.js';
import type { IAppModeState } from '../model/AppModeState.js';
import type { ClickRegion } from '../model/ClickRegion.js';
import type { ICommandModeState } from '../model/CommandModeState.js';
import type { IConversationListState } from '../model/ConversationListState.js';
import type { IConversationSession } from '../model/ConversationSession.js';
import type { IConversationState } from '../model/ConversationState.js';
import type { IEditorBuffer } from '../model/EditorBuffer.js';
import type { IHistoryViewState } from '../model/HistoryViewState.js';
import type { IGraphemeSegmenter } from '../model/IGraphemeSegmenter.js';
import type { ITurnClock } from '../model/ITurnClock.js';
import type { IPrimaryViewState } from '../model/PrimaryViewState.js';
import type { IScrollState } from '../model/ScrollState.js';
import type { StatusState } from '../model/StatusState.js';
import type { ITerminalState } from '../model/TerminalState.js';
import type { IToolApprovalState } from '../model/ToolApprovalState.js';

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
  editorBuffer: IEditorBuffer;
  segmenter: IGraphemeSegmenter;
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
  configLoader: ConfigLoader<typeof sdkConfigSchema>;
  /** Wall-clock, injected rather than read from the system, so a view that shows an age is provable. */
  clock: Clock;
};

/**
 * One painted screen: the rows, and the spans within them a click can act on.
 *
 * The regions come back with the rows because the view is the only thing that knows
 * where it put anything. Wrapping, indenting and scroll windowing all happen inside
 * the render, and nothing downstream can recover them from strings. A frame is rebuilt
 * whole every paint, so its regions are replaced wholesale rather than accumulated.
 */
export type Frame = {
  rows: string[];
  regions: ClickRegion[];
};

/**
 * A presentation's render surface. It renders the model to a full frame and does
 * nothing else: no key handling, no I/O, no store mutation. Returning a region is not
 * acting on one — the frame describes what a click would hit, and the input chain is
 * what invokes it.
 */
export interface View {
  render(model: ViewModel): Frame;
}
