import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import matter from 'gray-matter';
import { loadConfig } from '../../core/config.js';
import { applySuggestions } from '../../review/review-apply.js';
import { findTestCaseMarkdownById } from '../../review/reviewer.js';

export interface ReviewApplyOpts {
  config?: string;
  id?: string;
  suite?: string;
  acceptAll?: boolean;
  rejectAll?: boolean;
  acceptAbove?: string;
}

export async function runReviewApply(opts: ReviewApplyOpts): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const ids = await resolveIds(loaded.config.outputDir, opts);
  if (!ids.length) {
    console.log(chalk.yellow('Nothing to apply. Use --id or --suite, and at least one of --accept-all / --reject-all / --accept-above N.'));
    return;
  }
  if (!opts.acceptAll && !opts.rejectAll && !opts.acceptAbove) {
    console.error(chalk.red('Pick a decision: --accept-all | --reject-all | --accept-above N'));
    process.exit(1);
  }

  let totalApplied = 0;
  let totalRejected = 0;
  for (const id of ids) {
    const path = await findTestCaseMarkdownById(loaded.config.outputDir, id);
    if (!path) {
      console.log(chalk.red(`  ✗ TC-${id}: not found`));
      continue;
    }
    try {
      const r = await applySuggestions(path, {
        acceptAll: opts.acceptAll,
        rejectAll: opts.rejectAll,
        acceptAboveConfidence: opts.acceptAbove ? Number(opts.acceptAbove) : undefined,
      });
      totalApplied += r.applied;
      totalRejected += r.rejected;
      console.log(
        `  ${r.markdownChanged ? chalk.green('✓') : chalk.gray('·')} TC-${id}: ` +
          `applied=${r.applied} rejected=${r.rejected} pending=${r.pending}`,
      );
    } catch (err) {
      console.log(chalk.red(`  ✗ TC-${id}: ${(err as Error).message}`));
    }
  }
  console.log(chalk.gray(`Total: applied=${totalApplied} rejected=${totalRejected}`));
}

async function resolveIds(outputDir: string, opts: ReviewApplyOpts): Promise<number[]> {
  if (opts.id) return opts.id.split(',').map((s) => Number(s.trim())).filter(Boolean);
  if (opts.suite) {
    const suiteId = Number(opts.suite);
    const ids: number[] = [];
    const entries = await readdir(outputDir, { recursive: true, withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile() || !e.name.startsWith('TC-') || !e.name.endsWith('.md')) continue;
      const parent = (e as { parentPath?: string; path?: string }).parentPath ??
        (e as { parentPath?: string; path?: string }).path ?? outputDir;
      const text = await readFile(join(parent, e.name), 'utf8');
      const parsed = matter(text);
      const suiteIds = Array.isArray(parsed.data.suiteIds) ? (parsed.data.suiteIds as number[]) : [];
      if (suiteIds.includes(suiteId)) ids.push(Number(parsed.data.id ?? 0));
    }
    return ids;
  }
  return [];
}
