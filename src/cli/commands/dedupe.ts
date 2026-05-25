import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import chalk from 'chalk';
import { loadConfig } from '../../core/config.js';
import { findDuplicates } from '../../quality/dedupe.js';
import { table } from '../formatters.js';
import type { TestCase } from '../../core/types.js';

export interface DedupeOpts {
  config?: string;
  threshold?: string;
  format?: 'table' | 'json';
}

export async function runDedupe(opts: DedupeOpts): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const threshold = opts.threshold ? Number(opts.threshold) : 0.7;

  const cases: TestCase[] = [];
  const entries = await readdir(loaded.config.outputDir, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.startsWith('TC-') || !e.name.endsWith('.md')) continue;
    const parent = (e as { parentPath?: string; path?: string }).parentPath ??
      (e as { parentPath?: string; path?: string }).path ?? loaded.config.outputDir;
    const text = await readFile(join(parent, e.name), 'utf8');
    const parsed = matter(text);
    cases.push(mdToTestCase(parsed.data, parsed.content));
  }

  const pairs = findDuplicates(cases, threshold);
  if (opts.format === 'json') {
    console.log(JSON.stringify(pairs, null, 2));
    return;
  }
  if (!pairs.length) {
    console.log(chalk.green('No duplicates found.'));
    return;
  }
  console.log(
    table(
      ['A', 'B', 'Similarity', 'A title', 'B title'],
      pairs.map((p) => [
        String(p.a),
        String(p.b),
        `${(p.similarity * 100).toFixed(0)}%`,
        p.aTitle.slice(0, 40),
        p.bTitle.slice(0, 40),
      ]),
    ),
  );
  console.log(chalk.gray(`${pairs.length} duplicate pair(s) above ${(threshold * 100).toFixed(0)}%`));
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
    createdDate: '',
    changedDate: '',
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
