import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import chalk from 'chalk';
import { loadConfig } from '../../core/config.js';
import { scoreTestCaseHeuristic, summarizeIssues } from '../../quality/quality-score.js';
import { table } from '../formatters.js';
import type { TestCase } from '../../core/types.js';

export interface QualityOpts {
  config?: string;
  threshold?: string;
  format?: 'table' | 'json';
  suite?: string;
}

export async function runQuality(opts: QualityOpts): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const threshold = opts.threshold ? Number(opts.threshold) : 100;
  const suiteId = opts.suite ? Number(opts.suite) : null;

  const rows: Array<{ id: number; title: string; score: number; issues: string[] }> = [];
  const entries = await readdir(loaded.config.outputDir, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.startsWith('TC-') || !e.name.endsWith('.md')) continue;
    const parent = (e as { parentPath?: string; path?: string }).parentPath ??
      (e as { parentPath?: string; path?: string }).path ?? loaded.config.outputDir;
    const text = await readFile(join(parent, e.name), 'utf8');
    const parsed = matter(text);
    if (suiteId !== null) {
      const suiteIds = Array.isArray(parsed.data.suiteIds) ? (parsed.data.suiteIds as number[]) : [];
      if (!suiteIds.includes(suiteId)) continue;
    }
    const tc = mdToTestCase(parsed.data, parsed.content);
    const score = scoreTestCaseHeuristic(tc, loaded.config);
    if (score.overall >= threshold) continue;
    rows.push({
      id: tc.id,
      title: tc.title,
      score: score.overall,
      issues: summarizeIssues(score),
    });
  }
  rows.sort((a, b) => a.score - b.score);

  if (opts.format === 'json') {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  console.log(
    table(
      ['TC', 'Score', 'Title', 'Issues'],
      rows.map((r) => [
        String(r.id),
        colorScore(r.score),
        r.title.slice(0, 50),
        r.issues.slice(0, 2).join('; ') + (r.issues.length > 2 ? '…' : ''),
      ]),
    ),
  );
  console.log(chalk.gray(`${rows.length} case(s) below threshold ${threshold}`));
}

function colorScore(n: number): string {
  if (n >= 80) return chalk.green(String(n));
  if (n >= 60) return chalk.yellow(String(n));
  return chalk.red(String(n));
}

function mdToTestCase(data: Record<string, unknown>, body: string): TestCase {
  const steps: TestCase['steps'] = [];
  const re = /### Step (\d+)[\s\S]*?(?:\*\*Action:\*\*\s*([\s\S]*?))(?:\n\*\*Expected:\*\*\s*([\s\S]*?))?(?=\n### Step|\n## |$)/g;
  for (const m of body.matchAll(re)) {
    steps.push({
      id: Number(m[1]),
      action: (m[2] ?? '').trim(),
      expected: (m[3] ?? '').trim(),
      isSharedStep: false,
    });
  }
  return {
    id: Number(data.id ?? 0),
    rev: Number(data.rev ?? 0),
    title: String(data.title ?? ''),
    state: String(data.state ?? ''),
    priority: Number(data.priority ?? 3),
    areaPath: String(data.areaPath ?? ''),
    iterationPath: String(data.iterationPath ?? ''),
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    description: extractSection(body, 'Description'),
    preconditions: extractSection(body, 'Preconditions'),
    steps,
    createdDate: String(data.createdDate ?? ''),
    changedDate: String(data.changedDate ?? ''),
    fields: {},
    attachments: [],
    suiteIds: Array.isArray(data.suiteIds) ? (data.suiteIds as number[]) : [],
    planIds: Array.isArray(data.planIds) ? (data.planIds as number[]) : [],
  };
}

function extractSection(body: string, name: string): string | undefined {
  const m = new RegExp(`##\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i').exec(body);
  return m?.[1]?.trim();
}
