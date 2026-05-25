import { describe, it, expect } from 'vitest';
import { slugify, testCaseFile } from '../src/core/paths.js';

describe('slugify', () => {
  it('lowercases and replaces spaces', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips illegal Windows chars', () => {
    expect(slugify('a/b:c*d?e')).not.toMatch(/[<>:"/\\|?*]/);
  });

  it('truncates long input', () => {
    const long = 'a'.repeat(120);
    expect(slugify(long, 50).length).toBeLessThanOrEqual(50);
  });

  it('falls back to "untitled" when empty', () => {
    expect(slugify('***')).toBe('untitled');
  });
});

describe('testCaseFile', () => {
  it('produces TC-N-slug.md inside plan/suite folders', () => {
    const p = testCaseFile(
      { outputDir: 'out', projectName: 'My Project' },
      42, 'Sprint One',
      10, 'Login Tests',
      555, 'Verify Login',
    );
    expect(p).toMatch(/my-project/);
    expect(p).toMatch(/plan-42-sprint-one/);
    expect(p).toMatch(/suite-10-login-tests/);
    expect(p).toMatch(/TC-555-verify-login\.md$/);
  });
});
