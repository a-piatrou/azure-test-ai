import { describe, it, expect } from 'vitest';
import { ConfigSchema } from '../src/core/config-schema.js';

describe('ConfigSchema', () => {
  it('accepts minimal config', () => {
    const parsed = ConfigSchema.parse({
      organization: 'myorg',
      projects: [{ name: 'p1' }],
    });
    expect(parsed.outputDir).toBe('./test-cases');
    expect(parsed.concurrency).toBe(5);
    expect(parsed.projects[0]?.planIds).toEqual([]);
  });

  it('rejects empty organization', () => {
    expect(() => ConfigSchema.parse({ organization: '', projects: [{ name: 'p' }] })).toThrow();
  });

  it('rejects unknown top-level keys', () => {
    expect(() =>
      ConfigSchema.parse({
        organization: 'x',
        projects: [{ name: 'p' }],
        unknown: 1,
      }),
    ).toThrow();
  });

  it('applies defaults for git/review/quality blocks', () => {
    const parsed = ConfigSchema.parse({ organization: 'x', projects: [{ name: 'p' }] });
    expect(parsed.git.enabled).toBe(false);
    expect(parsed.review.model).toBe('claude-opus-4-7');
    expect(parsed.quality.useLlm).toBe(false);
  });
});
