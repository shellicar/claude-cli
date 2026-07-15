/**
 * The two horizontal-rule widths, kept together so their difference is obviously
 * deliberate — not an accident of living in separate files that invites someone to
 * "tidy" them into one constant.
 *
 * They are different on purpose. The markdown `---` is the model's own separator,
 * emitted inside a response; the wider labelled rule is the app's own block and mode
 * boundary. Keeping the app boundary wider means a `---` Claude writes mid-response
 * never reads as a new block starting. Do not unify them.
 */

/** markdown `---` thematic break: the model's own in-response separator. */
export const HR_WIDTH = 48;

/** block header / prompt divider minimum: the app's block & mode separators. */
export const MIN_DIVIDER_WIDTH = 60;
