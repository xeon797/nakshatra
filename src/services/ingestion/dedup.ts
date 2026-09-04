import crypto from 'crypto';

/**
 * Computes exact SHA-256 hash of normalized text
 */
export function generateContentHash(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * 64-bit FNV-1a hash function for strings
 */
function fnv1a64(str: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash;
}

/**
 * Computes 64-bit SimHash fingerprint for near-duplicate text detection.
 * Uses both unigram tokens and bigram shingles for high stability across short & long texts.
 */
export function computeSimHash(text: string): bigint {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 1);

  if (words.length === 0) {
    return 0n;
  }

  // Tokens include unigrams and bigrams
  const tokens: { text: string; weight: number }[] = [];
  for (const w of words) {
    tokens.push({ text: w, weight: 1 });
  }
  for (let i = 0; i < words.length - 1; i++) {
    tokens.push({ text: `${words[i]}_${words[i + 1]}`, weight: 2 });
  }

  const v = new Int32Array(64);

  for (const token of tokens) {
    const hash = fnv1a64(token.text);
    for (let bit = 0; bit < 64; bit++) {
      const bitValue = (hash >> BigInt(bit)) & 1n;
      if (bitValue === 1n) {
        v[bit] += token.weight;
      } else {
        v[bit] -= token.weight;
      }
    }
  }

  let fingerprint = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (v[bit] > 0) {
      fingerprint |= 1n << BigInt(bit);
    }
  }

  return fingerprint;
}

/**
 * Computes the Hamming distance (number of differing bits) between two 64-bit numbers
 */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/**
 * Returns true if two texts are near-duplicates
 * Hamming distance <= 8 indicates near-identical syndication / minor edit (out of 64 bits).
 */
export function isNearDuplicate(hashA: bigint, hashB: bigint, maxHammingDistance = 8): boolean {
  return hammingDistance(hashA, hashB) <= maxHammingDistance;
}
