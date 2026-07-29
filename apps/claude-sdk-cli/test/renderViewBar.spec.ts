import { CYAN, DIM, RESET, UNDERLINE } from '@shellicar/claude-core/ansi';
import { describe, expect, it } from 'vitest';
import { renderViewBar } from '../src/view/renderViewBar.js';

describe('renderViewBar', () => {
  it('renders the active primary entry accented and the others dimmed', () => {
    const expected = `${CYAN}${UNDERLINE}F1 primary${RESET}    ${DIM}F2 history${RESET}    ${DIM}F3 conversations${RESET}`;
    const actual = renderViewBar('primary');
    expect(actual).toBe(expected);
  });

  it('renders the active history entry accented and the others dimmed', () => {
    const expected = `${DIM}F1 primary${RESET}    ${CYAN}${UNDERLINE}F2 history${RESET}    ${DIM}F3 conversations${RESET}`;
    const actual = renderViewBar('history');
    expect(actual).toBe(expected);
  });

  it('renders the active conversations entry accented and the others dimmed', () => {
    const expected = `${DIM}F1 primary${RESET}    ${DIM}F2 history${RESET}    ${CYAN}${UNDERLINE}F3 conversations${RESET}`;
    const actual = renderViewBar('conversations');
    expect(actual).toBe(expected);
  });
});
