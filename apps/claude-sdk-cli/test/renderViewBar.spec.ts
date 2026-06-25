import { CYAN, DIM, RESET, UNDERLINE } from '@shellicar/claude-core/ansi';
import { describe, expect, it } from 'vitest';
import { renderViewBar } from '../src/view/renderViewBar.js';

describe('renderViewBar', () => {
  it('renders the active primary entry accented and the history entry dimmed', () => {
    const expected = `${CYAN}${UNDERLINE}F1 primary${RESET}    ${DIM}F2 history${RESET}`;
    const actual = renderViewBar('primary');
    expect(actual).toBe(expected);
  });

  it('renders the active history entry accented and the primary entry dimmed', () => {
    const expected = `${DIM}F1 primary${RESET}    ${CYAN}${UNDERLINE}F2 history${RESET}`;
    const actual = renderViewBar('history');
    expect(actual).toBe(expected);
  });
});
