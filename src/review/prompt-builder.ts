import type { TestCase } from '../core/types.js';
import type { QualityScore } from '../core/types.js';

export interface PromptOptions {
  baseUrl?: string;
  qualityScore?: QualityScore;
}

/**
 * Generate the prompt that Claude (running in an agent loop with Playwright MCP)
 * will execute to evaluate a single test case. The prompt:
 *   1) Explains the task: execute the test against a real UI and report.
 *   2) Lists the steps verbatim.
 *   3) Demands a structured JSON output with `outcome` and `suggestions[]`.
 */
export function buildReviewPrompt(tc: TestCase, opts: PromptOptions = {}): string {
  const stepsBlock = tc.steps
    .map((s, idx) => {
      const n = idx + 1;
      if (s.isSharedStep) {
        return `${n}. (shared step #${s.sharedStepId} — expand from referenced shared step)`;
      }
      const expected = s.expected ? `\n   expected: ${s.expected}` : '';
      return `${n}. ${s.action}${expected}`;
    })
    .join('\n');

  const tags = tc.tags.length ? `Tags: ${tc.tags.join(', ')}` : 'Tags: (none)';
  const heuristics = opts.qualityScore
    ? `\n\nHeuristic quality score (pre-execution): ${opts.qualityScore.overall}/100. ` +
      `Flags: ${opts.qualityScore.signals.ambiguityFlags.join(', ') || 'none'}.`
    : '';

  return `You are an expert QA engineer reviewing a manual test case by executing it on a live application.

Test case #${tc.id} (rev ${tc.rev}): ${tc.title}
Priority: P${tc.priority}  ·  State: ${tc.state}  ·  ${tags}
${tc.description ? `\nDescription:\n${tc.description}\n` : ''}${tc.preconditions ? `\nPreconditions:\n${tc.preconditions}\n` : ''}
Steps:
${stepsBlock}${heuristics}

Your task:
1. Open ${opts.baseUrl ?? '(the configured base URL)'} using the Playwright MCP tools available.
2. Execute each step in order. Use the Playwright tools to interact (click, fill, navigate).
3. After each step, verify the expected outcome. Capture a screenshot if the result diverges from expectation.
4. Identify weaknesses in the test case itself: ambiguous wording, missing preconditions, missing assertions, redundant or unreachable steps, missing tags, etc.
5. Suggest concrete improvements with high actionability.

Output STRICTLY a single JSON object matching this schema (no surrounding prose):
{
  "outcome": "pass" | "fail" | "partial" | "inconclusive",
  "rationale": "1-3 sentence summary of what happened end-to-end",
  "suggestions": [
    {
      "id": "s1",
      "kind": "add-step" | "rewrite-step" | "delete-step" | "add-precondition" | "rewrite-precondition" | "add-tag" | "rewrite-title" | "add-expected" | "rewrite-expected" | "add-description" | "add-automation-note",
      "confidence": 1 | 2 | 3 | 4 | 5,
      "targetStepId": <step id when applicable>,
      "before": "current text being replaced (optional)",
      "after": "the proposed new text",
      "rationale": "why this is an improvement",
      "evidence": {
        "actualOutcome": "what actually happened during execution (optional)",
        "selector": "CSS/text selector that revealed the issue (optional)"
      }
    }
  ]
}

Rules:
- Use confidence 5 only when you reproduced the issue at least once.
- For rewrite-step suggestions, "before" MUST quote the exact existing text from the test case.
- Prefer concrete, testable language ("Verify the 'Submit' button is disabled when email field is empty") over vague language ("Verify form behaves correctly").
- If the test case is already excellent, return an empty suggestions array.`;
}
