/**
 * Near-duplicate detection for the history sweep: shingling → MinHash → LSH → clustering.
 *
 * The sweep collapses the near-identical copies a fleet dispatch leaves in the record: the same turn run many times
 * over, each copy a distinct message with a distinct `id`. The store's `id` key dedups exact repeats; it never
 * catches these, because no two copies share an `id`. This finds them by content.
 *
 * The pieces:
 * - **shingles** turn a message's text into a set of overlapping k-word runs, so word order counts but a small edit
 *   only changes a few shingles.
 * - **MinHash** reduces that set to a fixed-length signature whose matching-position rate estimates the Jaccard
 *   similarity of two shingle sets, cheap to compare and cheap to bucket.
 * - **LSH** splits the signature into bands; two messages that share any band bucket are candidates, so only likely
 *   pairs are compared instead of every pair.
 *
 * Every function here is pure and deterministic: the same items and config always produce the same clusters. The
 * store's side of the sweep — the lease, the watermark, dropping a collapsed row from the FTS mirror — lives in the
 * sweep engine, not here.
 */

const TOKEN = /[\p{L}\p{N}]+/gu;
const MAX_U32 = 0xffffffff;

/** How the near-duplicate pass is tuned. `hashCount` must be divisible by `bands`; `rows` per band is the quotient. */
export type DedupConfig = {
  /** Words per shingle (k). Larger k demands longer verbatim runs to match. */
  shingleSize: number;
  /** MinHash signature length. */
  hashCount: number;
  /** LSH bands. More bands surface more candidate pairs (higher recall, more comparisons). */
  bands: number;
  /** Minimum estimated similarity in `[0, 1]` for two messages to count as near-duplicates. */
  threshold: number;
};

/** One message reduced to the text the sweep matches on. */
export type DedupItem = {
  id: string;
  text: string;
};

/** A near-duplicate cluster: the row that survives, and the copies that collapse into it. */
export type DedupCluster = {
  canonicalId: string;
  duplicateIds: string[];
};

/** The lowercased alphanumeric tokens of `text` — the same split `unicode61` applies before FTS5 stems, so "shared" means shared as the index sees a term. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN) ?? [];
}

/** The overlapping k-word runs of `text`, lowercased. Fewer than k words yields a single shingle of all of them; no words yields none. */
export function shingles(text: string, k: number): string[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return [];
  }
  if (tokens.length <= k) {
    return [tokens.join(' ')];
  }
  const out: string[] = [];
  for (let i = 0; i + k <= tokens.length; i++) {
    out.push(tokens.slice(i, i + k).join(' '));
  }
  return out;
}

// FNV-1a over the shingle's characters, the seed folded into the offset basis so each of the `hashCount` positions is
// an independent hash. `Math.imul` keeps the multiply in 32 bits; `>>> 0` keeps every value an unsigned 32-bit int.
function hashShingle(shingle: string, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < shingle.length; i++) {
    h ^= shingle.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** The MinHash signature of a shingle set: for each of `hashCount` hashes, the smallest hash over the shingles. Empty shingles give the all-max sentinel signature. */
export function minhashSignature(shingleSet: readonly string[], hashCount: number): number[] {
  const signature = new Array<number>(hashCount).fill(MAX_U32);
  for (const shingle of shingleSet) {
    for (let seed = 0; seed < hashCount; seed++) {
      const h = hashShingle(shingle, seed);
      if (h < signature[seed]) {
        signature[seed] = h;
      }
    }
  }
  return signature;
}

/** The `bands` LSH band buckets of a signature. Each bucket string is prefixed with its band index, so band 0 and band 1 never collide on equal contents. */
export function lshBuckets(signature: readonly number[], bands: number): string[] {
  const rows = Math.floor(signature.length / bands);
  const buckets: string[] = [];
  for (let band = 0; band < bands; band++) {
    const start = band * rows;
    buckets.push(`${band}:${signature.slice(start, start + rows).join(',')}`);
  }
  return buckets;
}

/** The estimated Jaccard similarity of two signatures: the fraction of positions that agree. */
export function estimateSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) {
    return 0;
  }
  let same = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) {
      same++;
    }
  }
  return same / n;
}

// Union-find (disjoint set) over item indices, path-compressed. Only used to merge near-duplicate pairs into clusters.
class UnionFind {
  readonly #parent: number[];

  public constructor(size: number) {
    this.#parent = Array.from({ length: size }, (_, i) => i);
  }

  public find(i: number): number {
    let root = i;
    while (this.#parent[root] !== root) {
      root = this.#parent[root];
    }
    for (let node = i; this.#parent[node] !== root; ) {
      const next = this.#parent[node];
      this.#parent[node] = root;
      node = next;
    }
    return root;
  }

  public union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      // Keep the lower index as the root, so a cluster's root is its earliest-seen (canonical) item.
      this.#parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
    }
  }
}

/**
 * The near-duplicate clusters among `items`, each cluster's canonical the earliest item in it (so pass items in the
 * order the canonical should win — chronological). Only clusters with a duplicate are returned; a unique item yields
 * nothing. Candidates are drawn from shared LSH buckets and confirmed against `threshold`, so a bucket collision that
 * is not actually similar does not collapse anything.
 */
export function nearDuplicateClusters(items: readonly DedupItem[], config: DedupConfig): DedupCluster[] {
  const signatures = items.map((item) => minhashSignature(shingles(item.text, config.shingleSize), config.hashCount));

  // Group item indices by band bucket; two items in the same bucket are a candidate pair.
  const buckets = new Map<string, number[]>();
  items.forEach((_, i) => {
    for (const bucket of lshBuckets(signatures[i], config.bands)) {
      const members = buckets.get(bucket);
      if (members === undefined) {
        buckets.set(bucket, [i]);
      } else {
        members.push(i);
      }
    }
  });

  const groups = new UnionFind(items.length);
  for (const members of buckets.values()) {
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        if (estimateSimilarity(signatures[members[a]], signatures[members[b]]) >= config.threshold) {
          groups.union(members[a], members[b]);
        }
      }
    }
  }

  // Gather each root's members in item order; the root is the earliest index, so it is the canonical.
  const clustered = new Map<number, number[]>();
  items.forEach((_, i) => {
    const root = groups.find(i);
    const members = clustered.get(root);
    if (members === undefined) {
      clustered.set(root, [i]);
    } else {
      members.push(i);
    }
  });

  const result: DedupCluster[] = [];
  for (const [root, members] of clustered) {
    if (members.length > 1) {
      result.push({ canonicalId: items[root].id, duplicateIds: members.filter((i) => i !== root).map((i) => items[i].id) });
    }
  }
  return result;
}
