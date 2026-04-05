import { createEditFilePair } from '../EditFile/createEditFilePair';
import { nodeFs } from './nodeFs';

const { previewEdit, editFile } = createEditFilePair(nodeFs);

export { editFile as EditFile, previewEdit as PreviewEdit };
