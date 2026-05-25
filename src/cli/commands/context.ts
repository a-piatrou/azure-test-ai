import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { loadConfig } from '../../core/config.js';

export interface ContextOpts {
  config?: string;
  suite?: string;
  plan?: string;
  format?: 'md' | 'json';
}

export async function runContext(opts: ContextOpts): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const suiteId = opts.suite ? Number(opts.suite) : null;
  const planId = opts.plan ? Number(opts.plan) : null;
  const cases: Array<{ id: number; title: string; priority: number; steps: string[] }> = [];
  const entries = await readdir(loaded.config.outputDir, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.startsWith('TC-') || !e.name.endsWith('.md')) continue;
    const parent = (e as { parentPath?: string; path?: string }).parentPath ??
      (e as { parentPath?: string; path?: string }).path ?? loaded.config.outputDir;
    const text = await readFile(join(parent, e.name), 'utf8');
    const parsed = matter(text);
    const suiteIds = Array.isArray(parsed.data.suiteIds) ? (parsed.data.suiteIds as number[]) : [];
    const planIds = Array.isArray(parsed.data.planIds) ? (parsed.data.planIds as number[]) : [];
    if (suiteId !== null && !suiteIds.includes(suiteId)) continue;
    if (planId !== null && !planIds.includes(planId)) continue;
    cases.push({
      id: Number(parsed.data.id ?? 0),
      title: String(parsed.data.title ?? ''),
      priority: Number(parsed.data.priority ?? 3),
      steps: extractStepLines(parsed.content),
    });
  }
  cases.sort((a, b) => a.priority - b.priority || a.id - b.id);
  if (opts.format === 'json') {
    console.log(JSON.stringify(cases, null, 2));
    return;
  }
  for (const c of cases) {
    console.log(`# TC-${c.id} [P${c.priority}] ${c.title}`);
    for (const s of c.steps) console.log(`  ${s}`);
    console.log();
  }
}

function extractStepLines(body: string): string[] {
  const out: string[] = [];
  const re = /### Step (\d+)[\s\S]*?\*\*Action:\*\*\s*([\s\S]*?)(?:\n\*\*Expected:\*\*\s*([\s\S]*?))?(?=\n### Step|\n## |$)/g;
  for (const m of body.matchAll(re)) {
    const n = m[1];
    const action = (m[2] ?? '').trim().replace(/\s+/g, ' ');
    const expected = (m[3] ?? '').trim().replace(/\s+/g, ' ');
    out.push(`${n}. ${action}${expected ? ` → ${expected}` : ''}`);
  }
  return out;
}
