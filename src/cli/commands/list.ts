import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';
import { loadConfig } from '../../core/config.js';
import { table } from '../formatters.js';
import chalk from 'chalk';

export interface ListOpts {
  config?: string;
  priority?: string;
  suite?: string;
  tags?: string;
  format?: 'table' | 'json' | 'ids';
}

interface Summary {
  id: number;
  title: string;
  priority: number;
  state: string;
  tags: string[];
  suiteIds: number[];
  planIds: number[];
}

export async function runList(opts: ListOpts): Promise<void> {
  const loaded = await loadConfig(opts.config);
  if (!existsSync(loaded.config.outputDir)) {
    console.error(chalk.yellow(`No cache directory: ${loaded.config.outputDir}`));
    console.error('Run `sync` first.');
    process.exit(1);
  }
  const all = await loadAll(loaded.config.outputDir);
  let filtered = all;

  if (opts.priority) {
    const maxPri = Number(opts.priority);
    filtered = filtered.filter((c) => c.priority <= maxPri);
  }
  if (opts.suite) {
    const suiteId = Number(opts.suite);
    filtered = filtered.filter((c) => c.suiteIds.includes(suiteId));
  }
  if (opts.tags) {
    const required = opts.tags.split(',').map((s) => s.trim()).filter(Boolean);
    filtered = filtered.filter((c) => required.every((t) => c.tags.includes(t)));
  }

  filtered.sort((a, b) => a.priority - b.priority || a.id - b.id);

  switch (opts.format ?? 'table') {
    case 'json':
      console.log(JSON.stringify(filtered, null, 2));
      break;
    case 'ids':
      console.log(filtered.map((c) => c.id).join('\n'));
      break;
    default:
      console.log(
        table(
          ['ID', 'P', 'Title', 'State', 'Tags'],
          filtered.map((c) => [
            String(c.id),
            `P${c.priority}`,
            c.title,
            c.state,
            c.tags.slice(0, 4).join(', ') + (c.tags.length > 4 ? '…' : ''),
          ]),
        ),
      );
      console.log(chalk.gray(`(${filtered.length} case(s))`));
  }
}

async function loadAll(outputDir: string): Promise<Summary[]> {
  const out: Summary[] = [];
  const entries = await readdir(outputDir, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.startsWith('TC-') || !e.name.endsWith('.md')) continue;
    const parent = (e as { parentPath?: string; path?: string }).parentPath ??
      (e as { parentPath?: string; path?: string }).path ?? outputDir;
    const fullPath = join(parent, e.name);
    const text = await readFile(fullPath, 'utf8');
    const parsed = matter(text);
    const d = parsed.data;
    out.push({
      id: Number(d.id ?? 0),
      title: String(d.title ?? ''),
      priority: Number(d.priority ?? 3),
      state: String(d.state ?? ''),
      tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
      suiteIds: Array.isArray(d.suiteIds) ? (d.suiteIds as number[]) : [],
      planIds: Array.isArray(d.planIds) ? (d.planIds as number[]) : [],
    });
  }
  return out;
}
