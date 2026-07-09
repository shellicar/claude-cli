import { describe, expect, it } from 'vitest';
import { RESET, YELLOW } from '../src/ansi';
import { wrapLine } from '../src/reflow';

// An OSC 8 hyperlink, emitted exactly as the markdown palette emits it:
// introducer (ESC ]8;;URL ST) + visible label + closer (ESC ]8;; ST), ST = ESC \.
const ST = '\x1b\\';
const osc8 = (url: string, label: string): string => `\x1b]8;;${url}${ST}${label}\x1b]8;;${ST}`;

describe('wrapLine — OSC 8 hyperlinks', () => {
  it('measures a link at its label width when deciding where to wrap', () => {
    const url = 'https://example.com/'; // 20 visible columns, wraps at 10
    const expected = 2;
    const actual = wrapLine(osc8(url, url), 10).length;
    expect(actual).toBe(expected);
  });

  it('keeps active colour on the continuation line when the row also carries a link', () => {
    const url = 'https://example.com/';
    const line = `${YELLOW}${osc8(url, url)}${RESET}`;
    const wrapped = wrapLine(line, 10);
    const expected = true;
    const actual = (wrapped[1] ?? '').startsWith(YELLOW);
    expect(actual).toBe(expected);
  });
});

describe('wrapLine — CSI/SGR rendering is unchanged', () => {
  it('does not count an SGR colour toward the visible line width', () => {
    const expected = [`${YELLOW}helloworld${RESET}`, `${YELLOW}!${RESET}`];
    const actual = wrapLine(`${YELLOW}helloworld!${RESET}`, 10);
    expect(actual).toEqual(expected);
  });
});
