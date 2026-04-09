import { createEditFilePair } from '../EditFile/createEditFilePair';
import { nodeFs } from '../fs/nodeFs.js';

const { previewEdit, editFile } = createEditFilePair(nodeFs);

export { editFile as EditFile, previewEdit as PreviewEdit };
