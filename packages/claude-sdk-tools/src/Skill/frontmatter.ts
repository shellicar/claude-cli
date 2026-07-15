export interface SplitSkill {
  /** The raw text between the leading `---` fences (empty when there is no frontmatter). */
  frontmatter: string;
  /** Everything after the frontmatter block (the whole file when there is none). */
  body: string;
}

// A leading `---` fence, its lines, then a closing `---` fence on its own line. CRLF-tolerant.
const FENCE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Split a skill file into its raw frontmatter text and its body. The CLI reads the frontmatter only
 *  to build the catalogue (the `description`); `load` uses the body. Parsing the frontmatter's meaning
 *  is the caller's job — this only separates the two halves. */
export function splitFrontmatter(content: string): SplitSkill {
  const match = FENCE.exec(content);
  if (match === null) {
    return { frontmatter: '', body: content };
  }
  return { frontmatter: match[1], body: content.slice(match[0].length) };
}
