import chalk from 'chalk';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { loadConfig } from '../../core/config.js';
import { Reviewer, saveReview, findTestCaseMarkdownById } from '../../review/reviewer.js';
import type { TestCase } from '../../core/types.js';

export interface AiReviewOpts {
  config?: string;
  id?: string;
  suite?: string;
  url?: string;
  staticOnly?: boolean;
  promptOnly?: boolean;
  model?: string;
}

export async function runAiReview(opts: AiReviewOpts): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const ids = await resolveIds(loaded.config.outputDir, opts);
  if (!ids.length) {
    console.log(chalk.yellow('No test cases selected. Use --id or --suite.'));
    return;
  }
  if (!opts.promptOnly && !opts.staticOnly) {
    console.log(
      chalk.gray(
        'Tip: --static-only uses Claude API (no live UI), --prompt-only writes the prompt for an external Claude agent.',
      ),
    );
    console.log(chalk.gray('Defaulting to --prompt-only mode.'));
    opts.promptOnly = true;
  }

  const reviewer = new Reviewer();

  for (const id of ids) {
    const path = await findTestCaseMarkdownById(loaded.config.outputDir, id);
    if (!path) {
      console.log(chalk.red(`  ✗ TC-${id}: markdown not found in cache (run sync first)`));
      continue;
    }
    const tc = await reconstructTestCase(path);

    if (opts.staticOnly) {
      if (!loaded.anthropicApiKey) {
        console.error(chalk.red('ANTHROPIC_API_KEY required for --static-only'));
        process.exit(1);
      }
      console.log(chalk.gray(`  → static review TC-${id}...`));
      const artifact = await reviewer.runStaticReview({
        testCase: tc,
        filePath: path,
        baseUrl: opts.url,
        apiKey: loaded.anthropicApiKey,
        model: opts.model,
        config: loaded.config,
      });
      const out = await saveReview(artifact, path);
      console.log(chalk.green(`  ✓ TC-${id}: ${artifact.suggestions.length} suggestion(s), saved to ${out}`));
    } else {
      const result = await reviewer.writePromptOnly({
        testCase: tc,
        filePath: path,
        baseUrl: opts.url,
        apiKey: '',
        config: loaded.config,
      });
      console.log(chalk.green(`  ✓ TC-${id}: prompt at ${result.promptPath}`));
    }
  }
  if (opts.promptOnly) {
    console.log();
    console.log(chalk.bold('Next steps:'));
    console.log('  Open Claude (with Playwright MCP enabled) and paste a generated *.review-prompt.md.');
    console.log('  Then use `review-status` and `review-apply` once Claude has written *.review.json.');
  }
}

async function resolveIds(outputDir: string, opts: AiReviewOpts): Promise<number[]> {
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
      if (suiteIds.includes(suiteId)) {
        ids.push(Number(parsed.data.id ?? 0));
      }
    }
    return ids;
  }
  return [];
}

async function reconstructTestCase(markdownPath: string): Promise<TestCase> {
  const text = await readFile(markdownPath, 'utf8');
  const parsed = matter(text);
  const d = parsed.data;
  return {
    id: Number(d.id ?? 0),
    rev: Number(d.rev ?? 1),
    title: String(d.title ?? ''),
    state: String(d.state ?? 'Design'),
    priority: Number(d.priority ?? 3),
    areaPath: String(d.areaPath ?? ''),
    iterationPath: String(d.iterationPath ?? ''),
    tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
    assignedTo: d.assignedTo as string | undefined,
    description: extractSection(parsed.content, 'Description'),
    preconditions: extractSection(parsed.content, 'Preconditions'),
    steps: extractStepsFromMarkdown(parsed.content),
    automationStatus: d.automationStatus as string | undefined,
    automatedTestName: d.automatedTestName as string | undefined,
    createdDate: String(d.createdDate ?? ''),
    changedDate: String(d.changedDate ?? ''),
    changedBy: d.changedBy as string | undefined,
    fields: {},
    attachments: [],
    suiteIds: Array.isArray(d.suiteIds) ? (d.suiteIds as number[]) : [],
    planIds: Array.isArray(d.planIds) ? (d.planIds as number[]) : [],
  };
}

function extractSection(body: string, name: string): string | undefined {
  const m = new RegExp(`##\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i').exec(body);
  return m?.[1]?.trim();
}

function extractStepsFromMarkdown(body: string) {
  const steps: { id: number; action: string; expected: string; isSharedStep: boolean; sharedStepId?: number }[] = [];
  const re = /### Step (\d+)[\s\S]*?(?:\*\*Action:\*\*\s*([\s\S]*?)(?:\n\*\*Expected:\*\*\s*([\s\S]*?))?)?(?=\n### Step|\n## |$)/g;
  for (const m of body.matchAll(re)) {
    steps.push({
      id: Number(m[1]),
      action: (m[2] ?? '').trim(),
      expected: (m[3] ?? '').trim(),
      isSharedStep: false,
    });
  }
  return steps;
}
