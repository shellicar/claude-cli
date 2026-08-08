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
  return regions.find((region) => region.row === row && col >= region.startCol && col <= region.endCol) ?? null;
}

/**
 * Move transcript-relative regions onto the window the primary view paints, dropping
 * the ones it no longer shows. Mirrors windowTranscript's geometry: a transcript
 * shorter than the window is padded above, a longer one is sliced to its tail less the
 * scroll offset, and a scrolled window gives its final row to the position indicator.
 */
export function windowRegions(regions: readonly ClickRegion[], total: number, scrollRows: number, offset: number): ClickRegion[] {
  if (total <= scrollRows) {
    const padding = scrollRows - total;
    return regions.map((region) => ({ ...region, row: region.row + padding }));
  }
  const top = total - offset - scrollRows;
  const belowLast = offset > 0 ? scrollRows - 1 : scrollRows;
  const visible: ClickRegion[] = [];
  for (const region of regions) {
    const row = region.row - top;
    if (row >= 0 && row < belowLast) {
      visible.push({ ...region, row });
    }
  }
  return visible;
}
