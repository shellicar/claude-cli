import type { Attachment } from './AttachmentStore.js';

/**
 * Assemble the final message string from editor text and optional attachments.
 *
 * Attachments are appended as a single <attachments> block containing one
 * <attachment> per item, in order.
 * The format is part of the system prompt contract — the agent is told how these
 * blocks are structured so it can reference attached content correctly.
 *
 * Returns plain text unchanged when there are no attachments, so callers do not
 * need to handle the zero-attachment case specially.
 */
export function buildSubmitText(text: string, attachments: readonly Attachment[] | null): string {
  if (!attachments || attachments.length === 0) {
    return text;
  }
  const items: string[] = [];
  for (const att of attachments) {
    if (!att) {
      continue;
    }
    if (att.kind === 'text') {
      const showSize = att.sizeBytes >= 1024 ? `${(att.sizeBytes / 1024).toFixed(1)}KB` : `${att.sizeBytes}B`;
      const fullSize = att.fullSizeBytes >= 1024 ? `${(att.fullSizeBytes / 1024).toFixed(1)}KB` : `${att.fullSizeBytes}B`;
      const truncPrefix = att.truncated ? `// showing ${showSize} of ${fullSize} (truncated)\n` : '';
      items.push(`<attachment>\n${truncPrefix}${att.text}\n</attachment>`);
    } else if (att.kind === 'file') {
      const lines: string[] = [`path: ${att.path}`];
      if (att.fileType === 'missing') {
        lines.push('// not found');
      } else {
        lines.push(`type: ${att.fileType}`);
        if (att.fileType === 'file' && att.sizeBytes !== undefined) {
          const sz = att.sizeBytes;
          const sizeStr = sz >= 1024 ? `${(sz / 1024).toFixed(1)}KB` : `${sz}B`;
          lines.push(`size: ${sizeStr}`);
        }
      }
      items.push(`<attachment>\n${lines.join('\n')}\n</attachment>`);
    }
    // Image attachments are not serialised to text; they are sent as native
    // BetaImageBlockParam content blocks via the structured message path.
  }
  if (items.length === 0) {
    return text;
  }
  return `${text}\n\n<attachments>\n${items.join('\n')}\n</attachments>`;
}
