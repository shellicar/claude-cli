/** What separates one item from the next in what a tool writes, and what whoever reads them back
 *  splits on. Deliberately not the platform's: these bytes are a protocol between two ends that are
 *  both ours, so a machine whose convention is CRLF must still write what the other end reads. */
export const NEWLINE = '\n';
