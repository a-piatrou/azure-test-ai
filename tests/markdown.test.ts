import { describe, it, expect } from 'vitest';
import matter from 'gray-matter';
import { renderTestCase, contentHashOf, parseTestCaseMarkdown } from '../src/core/markdown.js';
import type { TestCase } from '../src/core/types.js';

function mkTestCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 100,
    rev: 1,
    title: 'Verify login',
    state: 'Design',
    priority: 2,
    areaPath: 'Proj\\Mod',
    iterationPath: 'Proj\\Sprint',
    tags: ['smoke', 'login'],
    description: 'Test the login flow',
    preconditions: 'User is registered',
    steps: [
      { id: 1, action: 'Open /login', expected: 'Form visible', isSharedStep: false },
      { id: 2, action: 'Type creds', expected: 'Submit enabled', isSharedStep: false },
    ],
    createdDate: '2024-01-01T00:00:00Z',
    changedDate: '2024-06-01T00:00:00Z',
    fields: {},
    attachments: [],
    suiteIds: [10],
    planIds: [1],
    ...overrides,
  };
}

describe('renderTestCase', () => {
  it('produces frontmatter + body with stable order', () => {
    const tc = mkTestCase();
    const md = renderTestCase(tc, { inlineSharedSteps: true });
    expect(md).toContain('id: 100');
    expect(md).toContain('# Verify login');
    expect(md).toContain('## Steps');
    expect(md).toContain('**Action:** Open /login');
    expect(md).toContain('**Expected:** Submit enabled');
  });

  it('round-trips frontmatter', () => {
    const tc = mkTestCase();
    const md = renderTestCase(tc, { inlineSharedSteps: true });
    const parsed = parseTestCaseMarkdown(md);
    expect(parsed.data.id).toBe(100);
    expect(parsed.data.tags).toEqual(['smoke', 'login']);
  });
});

describe('contentHashOf', () => {
  it('is stable across calls', () => {
    const tc = mkTestCase();
    expect(contentHashOf(tc, { inlineSharedSteps: true })).toBe(
      contentHashOf(tc, { inlineSharedSteps: true }),
    );
  });

  it('differs when steps differ', () => {
    const a = mkTestCase();
    const b = mkTestCase({ steps: [{ id: 1, action: 'Other', expected: 'X', isSharedStep: false }] });
    expect(contentHashOf(a, { inlineSharedSteps: true })).not.toBe(
      contentHashOf(b, { inlineSharedSteps: true }),
    );
  });

  it('is independent of rev/changedDate', () => {
    const a = mkTestCase({ rev: 1, changedDate: '2024-01-01' });
    const b = mkTestCase({ rev: 99, changedDate: '2025-12-31' });
    expect(contentHashOf(a, { inlineSharedSteps: true })).toBe(
      contentHashOf(b, { inlineSharedSteps: true }),
    );
  });
});
