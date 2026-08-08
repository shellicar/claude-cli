/**
 * An interactive span of a single rendered row, produced by the view that drew it
 * and resolved back to its payload when a click lands on it.
 *
 * Coordinates are zero-based and in the same space as the screen grid, not the
 * terminal's one-based mouse report; the input edge converts once.
 *
 * `text` is both the payload and the identity. A frame is rebuilt whole on every
 * paint, so regions cannot be compared by reference across a repaint, and two
 * regions carrying the same payload are indistinguishable in effect.
 */
export type ClickRegion = {
  row: number;
  startCol: number;
  endCol: number;
  text: string;
};

/** The region covering a point, or null when the point lands on none. */
export function hitTest(regions: readonly ClickRegion[], col: number, row: number): ClickRegion | null {
  throw new Error('hitTest is not implemented');
}
