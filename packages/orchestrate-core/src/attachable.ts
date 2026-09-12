/** What a request can carry as one attachment. */
const MAX_BYTES = 32 * 1024 * 1024;

const SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
  'application/pdf': (bytes) => bytes.subarray(0, 5).toString('binary') === '%PDF-' && isOnePdf(bytes),
  'image/png': (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/gif': (bytes) => bytes.subarray(0, 6).toString('binary') === 'GIF87a' || bytes.subarray(0, 6).toString('binary') === 'GIF89a',
  'image/webp': (bytes) => bytes.subarray(0, 4).toString('binary') === 'RIFF' && bytes.subarray(8, 12).toString('binary') === 'WEBP',
};

/** A PDF ends with its trailer, and has exactly one header: `cat a.pdf b.pdf` begins like a PDF and
 *  is not one, which the API rejects at the cost of the whole turn. */
function isOnePdf(bytes: Buffer): boolean {
  const text = bytes.toString('binary');
  return text.trimEnd().endsWith('%%EOF') && text.indexOf('%PDF-', 5) === -1;
}

/** Whether these bytes may be sent as what they claim to be. Anything doubtful is read as text
 *  instead: a request the API refuses costs the turn, and being wrong here is not recoverable. */
export function attachable(bytes: Buffer, type: string): boolean {
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return false;
  }
  return SIGNATURES[type]?.(bytes) ?? false;
}
