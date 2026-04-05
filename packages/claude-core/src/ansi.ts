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

// Styles
export const RESET = '\x1B[0m';
export const DIM = '\x1B[2m';
export const BOLD = '\x1B[1m';
export const INVERSE_ON = '\x1B[7m';
export const INVERSE_OFF = '\x1B[27m';

// Colors (foreground)
export const RED = '\x1B[31m';
export const GREEN = '\x1B[32m';
export const YELLOW = '\x1B[33m';
export const CYAN = '\x1B[36m';
export const BOLD_WHITE = '\x1B[1;97m';

// Misc
export const BEL = '\x07';
