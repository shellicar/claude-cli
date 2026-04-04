import { createEditFilePair } from '../EditFile/createEditFilePair';
import { nodeFs } from './nodeFs';

const { previewEdit, editFile } = createEditFilePair(nodeFs);
export { previewEdit as PreviewEdit, editFile as EditFile };
