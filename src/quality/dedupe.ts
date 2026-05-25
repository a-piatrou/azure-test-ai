import type { TestCase } from '../core/types.js';

/**
 * MinHash-style shingle similarity. Produces a value in [0, 1] where 1 means
 * identical token n-grams. No external embeddings needed — runs offline.
 *
 * Why this approach: real embeddings (Voyage, OpenAI) would be more accurate
 * but require network + cost. Shingle similarity catches obvious dupes and
 * scales to thousands of cases in seconds.
 */
export function dedupeSignature(tc: TestCase): Set<string> {
  const text = [
    tc.title,
    tc.description ?? '',
    tc.preconditions ?? '',
    ...tc.steps.map((s) => `${s.action} || ${s.expected}`),
  ]
    .join('\n')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = text.split(' ').filter(Boolean);
  const shingles = new Set<string>();
  const n = 3;
  for (let i = 0; i <= tokens.length - n; i++) {
    shingles.add(tokens.slice(i, i + n).join(' '));
  }
  return shingles;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size > b.size ? a : b;
  for (const s of smaller) if (larger.has(s)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface DedupePair {
  a: number;
  b: number;
  similarity: number;
  aTitle: string;
  bTitle: string;
}

export function findDuplicates(testCases: TestCase[], threshold = 0.7): DedupePair[] {
  const sigs = new Map<number, Set<string>>();
  for (const tc of testCases) sigs.set(tc.id, dedupeSignature(tc));
  const pairs: DedupePair[] = [];
  for (let i = 0; i < testCases.length; i++) {
    const a = testCases[i]!;
    for (let j = i + 1; j < testCases.length; j++) {
      const b = testCases[j]!;
      const sim = jaccard(sigs.get(a.id)!, sigs.get(b.id)!);
      if (sim >= threshold) {
        pairs.push({ a: a.id, b: b.id, similarity: sim, aTitle: a.title, bTitle: b.title });
      }
    }
  }
  pairs.sort((x, y) => y.similarity - x.similarity);
  return pairs;
}
