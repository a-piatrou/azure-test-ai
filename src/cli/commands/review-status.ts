import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import chalk from 'chalk';
import { loadConfig } from '../../core/config.js';
import { loadReview } from '../../review/reviewer.js';
import { table } from '../formatters.js';
import type { ReviewStatus } from '../../review/review-types.js';

export interface ReviewStatusOpts {
  config?: string;
  suite?: string;
  format?: 'table' | 'json';
}

export async function runReviewStatus(opts: ReviewStatusOpts): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const suiteId = opts.suite ? Number(opts.suite) : null;
  const statuses: ReviewStatus[] = [];

  const entries = await readdir(loaded.config.outputDir, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.startsWith('TC-') || !e.name.endsWith('.md')) continue;
    const parent = (e as { parentPath?: string; path?: string }).parentPath ??
      (e as { parentPath?: string; path?: string }).path ?? loaded.config.outputDir;
    const md = join(parent, e.name);
    const review = await loadReview(md);
    if (!review) continue;

    const text = await readFile(md, 'utf8');
    const parsed = matter(text);
    const suiteIds = Array.isArray(parsed.data.suiteIds) ? (parsed.data.suiteIds as number[]) : [];
    if (suiteId !== null && !suiteIds.includes(suiteId)) continue;

    const accepted = Object.values(review.decisions ?? {}).filter((s) => s === 'accepted').length;
    const rejected = Object.values(review.decisions ?? {}).filter((s) => s === 'rejected').length;
    const pending = Object.values(review.decisions ?? {}).filter((s) => s === 'pending').length;
    const avgConfidence = review.suggestions.length
      ? review.suggestions.reduce((acc, s) => acc + s.confidence, 0) / review.suggestions.length
      : 0;

    statuses.push({
      testCaseId: review.testCaseId,
      title: String(parsed.data.title ?? ''),
      suggestionCount: review.suggestions.length,
      pending,
      accepted,
      rejected,
      averageConfidence: Math.round(avgConfidence * 10) / 10,
      outcome: review.outcome,
      reviewedAt: review.reviewedAt,
      appliedAt: review.appliedAt,
      syncedBackAt: review.syncedBackAt,
    });
  }
  statuses.sort((a, b) => a.testCaseId - b.testCaseId);

  if (opts.format === 'json') {
    console.log(JSON.stringify(statuses, null, 2));
    return;
  }
  console.log(
    table(
      ['TC', 'Outcome', 'Sug', 'P/A/R', 'AvgConf', 'Applied', 'Synced', 'Title'],
      statuses.map((s) => [
        String(s.testCaseId),
        s.outcome,
        String(s.suggestionCount),
        `${s.pending}/${s.accepted}/${s.rejected}`,
        s.averageConfidence.toFixed(1),
        s.appliedAt ? '✓' : '',
        s.syncedBackAt ? '✓' : '',
        s.title.slice(0, 60),
      ]),
    ),
  );
  console.log(chalk.gray(`${statuses.length} review(s)`));
}
