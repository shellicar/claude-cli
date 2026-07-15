export const ESC = '\x1B[';

// Cursor
export const cursorAt = (row: number, col: number) => `${ESC}${row};${col}H`;
export const clearLine = `${ESC}2K`;
export const clearDown = `${ESC}J`;
export const showCursor = `${ESC}?25h`;
export const hideCursor = `${ESC}?25l`;

// Synchronized output (DECSET 2026)
export const syncStart = '\x1B[?2026h';
export const syncEnd = '\x1B[?2026l';

// Autowrap (DECAWM). Disabled during a paint so a full-width write never wraps
// at the right margin; every cell is positioned absolutely instead.
export const disableAutowrap = `${ESC}?7l`;
export const enableAutowrap = `${ESC}?7h`;

// Styles
export const RESET = '\x1B[0m';
export const DIM = '\x1B[2m';
export const UNDERLINE = '\x1B[4m';
export const BOLD = '\x1B[1m';
export const INVERSE_ON = '\x1B[7m';
export const INVERSE_OFF = '\x1B[27m';

// Colors (foreground)
export const RED = '\x1B[31m';
export const GREEN = '\x1B[32m';
export const YELLOW = '\x1B[33m';
export const CYAN = '\x1B[36m';
export const BOLD_WHITE = '\x1B[1;97m';

// Mouse tracking. 1000 = button-event tracking (reports the wheel as buttons
// 64/65); 1006 = SGR extended coordinates. Enabled while the alt buffer is
// active so the wheel scrolls the transcript instead of the terminal scrollback.
export const enableMouse = `${ESC}?1000h${ESC}?1006h`;
export const disableMouse = `${ESC}?1000l${ESC}?1006l`;

// Misc
export const BEL = '\x07';
