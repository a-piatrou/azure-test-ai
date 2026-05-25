import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { loadConfig } from '../../core/config.js';
import { table } from '../formatters.js';

export interface GapsOpts {
  config?: string;
  testsDir: string;
  format?: 'table' | 'json';
}

interface Gap {
  id: number;
  title: string;
  priority: number;
  state: string;
}

export async function runGaps(opts: GapsOpts): Promise<void> {
  if (!opts.testsDir) {
    console.error(chalk.red('--tests-dir is required'));
    process.exit(1);
  }
  if (!existsSync(opts.testsDir)) {
    console.error(chalk.red(`Tests directory not found: ${opts.testsDir}`));
    process.exit(1);
  }
  const loaded = await loadConfig(opts.config);

  // Find all automated test files with TC-{id} convention.
  const automatedIds = await collectAutomatedIds(opts.testsDir);

  // Walk cached test cases.
  const matter = (await import('gray-matter')).default;
  const cases: Gap[] = [];
  const entries = await readdir(loaded.config.outputDir, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.startsWith('TC-') || !e.name.endsWith('.md')) continue;
    const parent = (e as { parentPath?: string; path?: string }).parentPath ??
      (e as { parentPath?: string; path?: string }).path ?? loaded.config.outputDir;
    const text = await (await import('node:fs/promises')).readFile(join(parent, e.name), 'utf8');
    const parsed = matter(text);
    const id = Number(parsed.data.id ?? 0);
    if (automatedIds.has(id)) continue;
    cases.push({
      id,
      title: String(parsed.data.title ?? ''),
      priority: Number(parsed.data.priority ?? 3),
      state: String(parsed.data.state ?? ''),
    });
  }
  cases.sort((a, b) => a.priority - b.priority || a.id - b.id);

  if (opts.format === 'json') {
    console.log(JSON.stringify({ unautomated: cases }, null, 2));
    return;
  }
  console.log(
    table(
      ['ID', 'P', 'State', 'Title'],
      cases.map((c) => [String(c.id), `P${c.priority}`, c.state, c.title]),
    ),
  );
  console.log(chalk.gray(`${cases.length} test case(s) not automated`));
}

async function collectAutomatedIds(dir: string): Promise<Set<number>> {
  const ids = new Set<number>();
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const m = /TC-(\d+)/.exec(e.name);
    if (m && m[1]) ids.add(Number(m[1]));
  }
  return ids;
}
