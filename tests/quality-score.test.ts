import { describe, it, expect } from 'vitest';
import { scoreTestCaseHeuristic } from '../src/quality/quality-score.js';
import { ConfigSchema } from '../src/core/config-schema.js';
import type { TestCase } from '../src/core/types.js';

const cfg = ConfigSchema.parse({
  organization: 'x',
  projects: [{ name: 'p' }],
});

function tc(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 1,
    rev: 1,
    title: 't',
    state: 'Design',
    priority: 3,
    areaPath: '',
    iterationPath: '',
    tags: ['a'],
    description: 'a description longer than 20 chars',
    preconditions: 'pre',
    steps: [
      { id: 1, action: 'Click button to submit form', expected: 'Form is submitted successfully', isSharedStep: false },
      { id: 2, action: 'Read response from server', expected: 'Returns status 200', isSharedStep: false },
    ],
    createdDate: '',
    changedDate: '',
    fields: {},
    attachments: [],
    suiteIds: [],
    planIds: [],
    ...overrides,
  };
}

describe('quality score', () => {
  it('gives a good case a high score', () => {
    const s = scoreTestCaseHeuristic(tc(), cfg);
    expect(s.overall).toBeGreaterThanOrEqual(80);
  });

  it('penalises missing steps heavily', () => {
    const s = scoreTestCaseHeuristic(tc({ steps: [] }), cfg);
    expect(s.overall).toBeLessThan(50);
    expect(s.signals.hasSteps).toBe(false);
  });

  it('flags ambiguous wording', () => {
    const s = scoreTestCaseHeuristic(
      tc({
        steps: [{ id: 1, action: 'Maybe click something', expected: 'Should probably work', isSharedStep: false }],
      }),
      cfg,
    );
    expect(s.signals.ambiguityFlags.length).toBeGreaterThan(0);
  });
});
