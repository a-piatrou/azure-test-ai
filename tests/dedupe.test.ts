import { describe, it, expect } from 'vitest';
import { dedupeSignature, jaccard, findDuplicates } from '../src/quality/dedupe.js';
import type { TestCase } from '../src/core/types.js';

function mk(id: number, title: string, steps: string[]): TestCase {
  return {
    id,
    rev: 1,
    title,
    state: '',
    priority: 3,
    areaPath: '',
    iterationPath: '',
    tags: [],
    steps: steps.map((s, i) => ({ id: i + 1, action: s, expected: '', isSharedStep: false })),
    createdDate: '',
    changedDate: '',
    fields: {},
    attachments: [],
    suiteIds: [],
    planIds: [],
  };
}

describe('dedupe', () => {
  it('jaccard of identical sets is 1', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['a', 'b', 'c']);
    expect(jaccard(a, b)).toBe(1);
  });

  it('jaccard of disjoint sets is 0', () => {
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('finds near-duplicate test cases', () => {
    const a = mk(1, 'Login flow', ['open login page', 'enter username', 'enter password', 'click submit']);
    const b = mk(2, 'Sign in', ['open login page', 'enter username', 'enter password', 'click submit']);
    const c = mk(3, 'Checkout', ['add item to cart', 'go to checkout', 'pay']);
    const pairs = findDuplicates([a, b, c], 0.5);
    expect(pairs.length).toBe(1);
    expect(pairs[0]?.a).toBe(1);
    expect(pairs[0]?.b).toBe(2);
  });

  it('signature is non-empty for substantial text', () => {
    const a = mk(1, 'Long title here', ['step one with words', 'step two with more words']);
    expect(dedupeSignature(a).size).toBeGreaterThan(0);
  });
});
