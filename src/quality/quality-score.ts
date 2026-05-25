import type { TestCase } from '../core/types.js';
import type { QualityScore } from '../core/types.js';
import type { Config } from '../core/config-schema.js';

const AMBIGUITY_PATTERNS: Array<{ pattern: RegExp; flag: string }> = [
  { pattern: /\b(should|might|could|maybe|probably)\b/i, flag: 'uncertain-language' },
  { pattern: /\betc\.?\b/i, flag: 'open-ended-list' },
  { pattern: /\bsome\b|\bvarious\b|\bappropriate\b/i, flag: 'vague-quantifier' },
  { pattern: /^\s*(verify|check|test)\s*$/i, flag: 'empty-assertion' },
  { pattern: /TBD|TODO|FIXME/i, flag: 'unfinished' },
];

/**
 * Heuristic quality score for a test case. Range 0–100.
 * Penalises: missing steps, no expected results, no tags, ambiguous wording,
 * empty preconditions for high-priority cases.
 */
export function scoreTestCaseHeuristic(tc: TestCase, config: Config): QualityScore {
  const ambiguityFlags: string[] = [];
  const steps = tc.steps.filter((s) => !s.isSharedStep);
  const stepCount = tc.steps.length;
  const avgStepLength =
    steps.length === 0
      ? 0
      : Math.round(
          steps.reduce((acc, s) => acc + (s.action.length + s.expected.length), 0) / steps.length,
        );

  for (const step of steps) {
    for (const { pattern, flag } of AMBIGUITY_PATTERNS) {
      if (pattern.test(step.action) || pattern.test(step.expected)) {
        ambiguityFlags.push(`step-${step.id}:${flag}`);
      }
    }
  }
  if (tc.description) {
    for (const { pattern, flag } of AMBIGUITY_PATTERNS) {
      if (pattern.test(tc.description)) ambiguityFlags.push(`description:${flag}`);
    }
  }

  let score = 100;
  if (stepCount < config.quality.minStepCount) score -= 25;
  if (stepCount === 0) score -= 40;
  if (!tc.tags.length) score -= 10;
  if (!tc.description || tc.description.trim().length < config.quality.minDescriptionLength) score -= 10;
  if (!tc.preconditions && tc.priority <= 2) score -= 5;
  const stepsWithoutExpected = steps.filter((s) => !s.expected?.trim()).length;
  if (stepsWithoutExpected > 0) {
    score -= Math.min(20, stepsWithoutExpected * 5);
  }
  score -= Math.min(20, ambiguityFlags.length * 3);
  if (avgStepLength < 30 && steps.length > 0) score -= 5;
  if (score < 0) score = 0;

  return {
    overall: score,
    signals: {
      hasSteps: stepCount > 0,
      hasExpectedResults: stepsWithoutExpected === 0 && steps.length > 0,
      hasTags: tc.tags.length > 0,
      hasDescription: !!tc.description && tc.description.trim().length > 0,
      hasPreconditions: !!tc.preconditions && tc.preconditions.trim().length > 0,
      stepCount,
      averageStepLength: avgStepLength,
      ambiguityFlags: [...new Set(ambiguityFlags)],
    },
  };
}

export function summarizeIssues(score: QualityScore): string[] {
  const issues: string[] = [];
  if (!score.signals.hasSteps) issues.push('No steps defined');
  if (!score.signals.hasExpectedResults) issues.push('Some steps missing expected results');
  if (!score.signals.hasTags) issues.push('No tags — hard to filter/group');
  if (!score.signals.hasDescription) issues.push('Missing description');
  if (score.signals.ambiguityFlags.length) {
    issues.push(`Ambiguity flags: ${score.signals.ambiguityFlags.slice(0, 3).join(', ')}${score.signals.ambiguityFlags.length > 3 ? '…' : ''}`);
  }
  return issues;
}
