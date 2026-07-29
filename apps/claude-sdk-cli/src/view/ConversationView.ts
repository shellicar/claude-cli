import { ZoneId } from '@js-joda/core';
import { BOLD_WHITE, CYAN, DIM, GOLD, RESET } from '@shellicar/claude-core/ansi';
import { getContextWindow } from '@shellicar/claude-sdk';
import stringWidth from 'string-width';
import type { ConversationEntry } from '../model/ConversationListState.js';
import { formatAge, formatContext, formatCost, formatModel, formatSpan, formatTimeOfDay, oneLine, PENDING } from './formatConversationEntry.js';
import { renderViewBar } from './renderViewBar.js';
import type { View, ViewModel } from './View.js';

/** Marks the conversation this process is currently on. */
const CURRENT = '●';
/** Marks the selected row. Two columns, so selecting never reflows the line. */
const CURSOR = '> ';
const NO_CURSOR = '  ';

const USER = '👤';
const ASSISTANT = '🤖';
const TOOLS = '🔧';
const GAP = '⋮';
/** The gap marker stands in the emoji column, under a blank timestamp. `⋮` is one column where an
 *  emoji is two, so it carries an extra trailing space to keep the text column aligned. */
const GAP_PREFIX = `${' '.repeat(8)} ${GAP}   `;

/** Truncate to a visual width, so a double-width emoji costs the two columns it occupies. */
const fit = (text: string, width: number): string => {
  if (width <= 0) {
    return '';
  }
  if (stringWidth(text) <= width) {
    return text;
  }
  let out = '';
  for (const char of text) {
    if (stringWidth(out + char) > width - 1) {
      return `${out}…`;
    }
    out += char;
  }
  return out;
};

/**
 * The conversation view: every conversation ever live in this directory, four lines each — who and
 * when, the figures, the opening ask, the last reply. The selected one can be peeked open, which
 * inserts the tail of the conversation between its two preview lines.
 *
 * A row renders the same whatever else is on screen: peek adds lines to one entry and never changes
 * the shape of the others. Figures not yet read render as a dotted placeholder of the same width they
 * will occupy, so nothing jumps when a summary lands.
 *
 * Render-only: the loader fills summaries, the state owns selection and the peek flag.
 */
export class ConversationView implements View {
  public render(model: ViewModel): string[] {
    const { conversationListState, terminalState, appModeState, session, statusState } = model;
    const cols = terminalState.cols;
    const rows = terminalState.rows;
    const zone = ZoneId.systemDefault();

    const header = `${DIM} conversations in ${statusState.cwdBasename}${RESET}`;
    const hints = this.#hints(model);
    const bar = renderViewBar(appModeState.active);
    // Header, the blank under it, the key hints and the footer bar.
    const bodyHeight = Math.max(1, rows - 4);

    // A blank line after each entry, so the four lines of one conversation read as a block rather than
    // running into the next. It belongs to the entry so the scroll window moves whole entries with it.
    const blocks = conversationListState.entries.map((entry, index) => [...this.#entryLines(entry, index === conversationListState.selected, entry.id === session.id, conversationListState.peeked && index === conversationListState.selected, model, cols, zone), '']);

    const body = blocks.length === 0 ? [`${DIM}  no conversations recorded in this directory${RESET}`] : this.#windowed(blocks, conversationListState.selected, bodyHeight);

    return [header, '', ...body.slice(0, bodyHeight), ...Array(Math.max(0, bodyHeight - body.length)).fill(''), hints, bar];
  }

  /** What the keys do: the key itself accented, its effect beside it. A key that would be refused is
   *  drawn whole in grey with the reason, which is what tells the operator it will do nothing — switching
   *  is refused while a turn is running, because the turn belongs to the conversation being left. */
  #hints(model: ViewModel): string {
    const canSwitch = model.primaryViewState.phase === 'editor';
    const key = (glyph: string, effect: string): string => `${CYAN}${glyph}${RESET} ${DIM}${effect}${RESET}`;
    const refused = (glyph: string, effect: string, why: string): string => `${DIM}${glyph} ${effect} (${why})${RESET}`;
    const switchHint = canSwitch ? key('\u23ce', 'switch') : refused('\u23ce', 'switch', 'turn running');
    return ` ${key('\u2191\u2193', 'select')}    ${key('space', 'peek')}    ${switchHint}`;
  }

  /** Scroll so the selected entry is on screen, keeping whole entries: the list moves by entry, never
   *  leaving a row half-drawn at the top edge. */
  #windowed(blocks: string[][], selected: number, height: number): string[] {
    const flat = blocks.flat();
    if (flat.length <= height) {
      return flat;
    }
    let before = 0;
    for (let i = 0; i < selected; i++) {
      before += blocks[i]?.length ?? 0;
    }
    const selectedHeight = blocks[selected]?.length ?? 0;
    // Keep the selection visible: scroll only far enough to bring it fully into view.
    const start = Math.max(0, Math.min(before, flat.length - height, Math.max(0, before + selectedHeight - height)));
    return flat.slice(start, start + height);
  }

  #entryLines(entry: ConversationEntry, selected: boolean, current: boolean, peeked: boolean, model: ViewModel, cols: number, zone: ZoneId): string[] {
    const gutter = selected ? `${CYAN}${CURSOR}${RESET}` : NO_CURSOR;
    const summary = entry.summary;
    const mark = current ? `${CYAN}${CURRENT}${RESET} ` : '  ';
    const model_ = summary === undefined ? PENDING : formatModel(summary.model);
    const age = summary === undefined ? PENDING : formatAge(summary.lastUtc, model.clock.instant());
    const id = selected ? `${BOLD_WHITE}${entry.id}${RESET}` : `${DIM}${entry.id}${RESET}`;
    const identity = `${gutter}${mark}${model_}  ${id}  🕐 ${age}`;

    const figures =
      summary === undefined
        ? `${gutter}    ${DIM}💬 ${PENDING}  🔄 ${PENDING}  📊 ${PENDING}  ${PENDING}  ⏱ ${PENDING}${RESET}`
        : `${gutter}    💬 ${summary.queries}q  🔄 ${summary.turns}t  📊 ${formatContext(summary, getContextWindow(summary.model ?? ''))}  ${GOLD}${formatCost(summary.costUsd)}${RESET}  ⏱ ${formatSpan(summary.firstUtc, summary.lastUtc)}`;

    const lines = [fit(identity, cols), fit(figures, cols)];

    if (peeked) {
      lines.push(...this.#peekLines(entry, model, gutter, cols, zone));
      return lines;
    }

    lines.push(fit(`${gutter}  ${DIM}${this.#previewTime(summary?.firstUtc, zone)}${RESET} ${USER}  ${this.#preview(summary?.firstUserText, summary === undefined)}`, cols));
    lines.push(fit(`${gutter}  ${DIM}${this.#previewTime(summary?.lastUtc, zone)}${RESET} ${ASSISTANT}  ${this.#preview(summary?.lastAssistantText, summary === undefined)}`, cols));
    return lines;
  }

  /** The peek: the opening ask, the gap counter, then the tail of the conversation in order. The two
   *  preview lines are the ends of the same timeline, so nothing is shown twice. Every line carries the
   *  selection gutter, because the whole unfold belongs to the selected conversation. */
  #peekLines(entry: ConversationEntry, model: ViewModel, gutter: string, cols: number, zone: ZoneId): string[] {
    const peek = model.conversationListState.peek;
    const summary = entry.summary;
    const lines = [fit(`${gutter}  ${DIM}${this.#previewTime(summary?.firstUtc, zone)}${RESET} ${USER}  ${this.#preview(summary?.firstUserText, summary === undefined)}`, cols)];
    if (peek === undefined) {
      lines.push(`${gutter}${DIM}${GAP_PREFIX}reading…${RESET}`);
      return lines;
    }
    if (peek.earlier > 0) {
      lines.push(`${gutter}${DIM}${GAP_PREFIX}${peek.earlier} earlier messages${RESET}`);
    }
    for (const item of peek.entries) {
      const glyph = item.kind === 'user' ? USER : item.kind === 'assistant' ? ASSISTANT : TOOLS;
      lines.push(fit(`${gutter}  ${DIM}${this.#previewTime(item.timestampUtc, zone)}${RESET} ${glyph}  ${oneLine(item.text)}`, cols));
    }
    return lines;
  }

  #previewTime(whenUtc: string | null | undefined, zone: ZoneId): string {
    return formatTimeOfDay(whenUtc ?? null, zone);
  }

  #preview(text: string | null | undefined, pending: boolean): string {
    if (pending) {
      return `${DIM}${PENDING}${RESET}`;
    }
    return text == null || text.length === 0 ? `${DIM}(no message)${RESET}` : oneLine(text);
  }
}
