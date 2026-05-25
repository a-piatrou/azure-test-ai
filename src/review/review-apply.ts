import { readFile, writeFile } from 'node:fs/promises';
import matter from 'gray-matter';
import type { ReviewArtifact, ReviewSuggestion } from './review-types.js';
import { loadReview, saveReview, reviewFilePath } from './reviewer.js';
import { logger } from '../core/logger.js';

export interface ApplyOptions {
  acceptAll?: boolean;
  rejectAll?: boolean;
  acceptAboveConfidence?: number;
}

export interface ApplyResult {
  testCaseId: number;
  applied: number;
  rejected: number;
  pending: number;
  markdownChanged: boolean;
}

/**
 * Apply suggestions to a test case markdown file. We modify the markdown body
 * (after frontmatter) using deterministic textual replacements derived from the
 * suggestion. Frontmatter is preserved; we record `appliedAt` in the
 * `.review.json` so sync-back knows what's ready to push.
 */
export async function applySuggestions(
  markdownPath: string,
  opts: ApplyOptions,
): Promise<ApplyResult> {
  const review = await loadReview(markdownPath);
  if (!review) {
    throw new Error(`No review file alongside ${markdownPath}`);
  }
  const decisions = { ...(review.decisions ?? {}) };

  for (const s of review.suggestions) {
    if (decisions[s.id] === 'accepted' || decisions[s.id] === 'rejected') continue;
    if (opts.acceptAll) decisions[s.id] = 'accepted';
    else if (opts.rejectAll) decisions[s.id] = 'rejected';
    else if (opts.acceptAboveConfidence !== undefined && s.confidence >= opts.acceptAboveConfidence) {
      decisions[s.id] = 'accepted';
    } else {
      decisions[s.id] = decisions[s.id] ?? 'pending';
    }
  }

  const accepted = review.suggestions.filter((s) => decisions[s.id] === 'accepted');
  const rejected = review.suggestions.filter((s) => decisions[s.id] === 'rejected');
  const pending = review.suggestions.filter((s) => decisions[s.id] === 'pending');

  let markdownChanged = false;
  if (accepted.length) {
    const original = await readFile(markdownPath, 'utf8');
    const parsed = matter(original);
    const newBody = applyToMarkdown(parsed.content, parsed.data, accepted);
    if (newBody !== parsed.content) {
      const updated = matter.stringify(newBody, parsed.data);
      await writeFile(markdownPath, updated, 'utf8');
      markdownChanged = true;
    }
  }

  const updatedReview: ReviewArtifact = {
    ...review,
    decisions,
    appliedAt: accepted.length ? new Date().toISOString() : review.appliedAt,
  };
  await saveReview(updatedReview, markdownPath);
  logger.info(
    {
      tcId: review.testCaseId,
      applied: accepted.length,
      rejected: rejected.length,
      pending: pending.length,
    },
    'Review applied',
  );

  return {
    testCaseId: review.testCaseId,
    applied: accepted.length,
    rejected: rejected.length,
    pending: pending.length,
    markdownChanged,
  };
}

function applyToMarkdown(
  body: string,
  data: Record<string, unknown>,
  accepted: ReviewSuggestion[],
): string {
  let result = body;
  for (const s of accepted) {
    switch (s.kind) {
      case 'rewrite-step':
      case 'rewrite-expected':
      case 'rewrite-precondition':
      case 'rewrite-title':
        if (s.before && result.includes(s.before)) {
          result = result.replace(s.before, s.after);
        } else {
          // Append at end with annotation when we cannot locate the original
          result += `\n\n<!-- review: ${s.kind} (could not locate before-text) -->\n${s.after}\n`;
        }
        break;
      case 'add-step':
        result = result.replace(/(##\s*Steps[\s\S]*?)(\n##\s|$)/, (m, before, after) => {
          return `${before}\n\n### Step (added by review)\n\n**Action:** ${s.after}${s.evidence?.actualOutcome ? `\n**Expected:** ${s.evidence.actualOutcome}` : ''}\n${after}`;
        });
        break;
      case 'delete-step':
        if (s.before && result.includes(s.before)) {
          result = result.replace(s.before, '<!-- step deleted by review -->');
        }
        break;
      case 'add-precondition':
        if (!/##\s*Preconditions/i.test(result)) {
          result = result.replace(/(##\s*Description[\s\S]*?\n)(##|\Z)/m, (_m, d, next) => {
            return `${d}\n## Preconditions\n\n${s.after}\n\n${next ?? ''}`;
          });
        } else {
          result = result.replace(/(##\s*Preconditions\n+)/i, (m) => `${m}${s.after}\n\n`);
        }
        break;
      case 'add-description':
        if (!/##\s*Description/i.test(result)) {
          result = result.replace(/(^#\s+[^\n]+\n+>[^\n]+\n+)/, (_m, hdr) => {
            return `${hdr}\n## Description\n\n${s.after}\n\n`;
          });
        }
        break;
      case 'add-tag':
        // Mutate frontmatter instead of body.
        if (Array.isArray((data as { tags?: string[] }).tags)) {
          const tags = (data as { tags: string[] }).tags;
          if (!tags.includes(s.after)) tags.push(s.after);
        } else {
          (data as { tags?: string[] }).tags = [s.after];
        }
        break;
      case 'add-expected':
        // Append expected to target step if we can locate it.
        if (s.targetStepId !== undefined) {
          const stepHeader = new RegExp(`(### Step ${s.targetStepId}[\\s\\S]*?\\*\\*Action:\\*\\*[^\\n]+)`, 'i');
          result = result.replace(stepHeader, `$1\n**Expected:** ${s.after}`);
        }
        break;
      case 'add-automation-note':
        result += `\n\n## Automation Notes\n\n${s.after}\n`;
        break;
    }
  }
  return result;
}
