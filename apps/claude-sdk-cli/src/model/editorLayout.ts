/**
 * Visual column width of the editor's prompt prefix (PROMPT_PREFIX / INDENT,
 * defined in view/renderEditor). Shared by the editor renderer (draws the
 * prefix) and the editor key handler (navigates past it via
 * EditorState.moveUpVisual / moveDownVisual). Lives in model/ — the bottom layer
 * both view/ and controller/ import — so neither layer reaches across to the
 * other. Keep this in step with the width of PROMPT_PREFIX / INDENT.
 */
export const EDITOR_PREFIX_VISUAL_WIDTH = 3;
