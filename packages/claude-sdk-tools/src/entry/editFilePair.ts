import { createEditFilePair } from '../EditFile/createEditFilePair';
import { nodeFs } from './nodeFs';

const { editFile, confirmEditFile } = createEditFilePair(nodeFs);
export { editFile as EditFile, confirmEditFile as ConfirmEditFile };
