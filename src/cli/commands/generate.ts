import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import matter from 'gray-matter';
import { loadConfig } from '../../core/config.js';
import { slugify } from '../../core/paths.js';

export interface GenerateOpts {
  config?: string;
  ids?: string;
  suite?: string;
  framework?: 'playwright' | 'cypress';
  output?: string;
}

export async function runGenerate(opts: GenerateOpts): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const ids = opts.ids?.split(',').map((s) => Number(s.trim())).filter(Boolean) ?? [];
  const suiteId = opts.suite ? Number(opts.suite) : null;
  const framework = opts.framework ?? 'playwright';
  const outDir = opts.output ?? './tests/generated';
  await mkdir(outDir, { recursive: true });

  const cases = await loadTestCases(loaded.config.outputDir, ids, suiteId);
  if (!cases.length) {
    console.log(chalk.yellow('No test cases matched.'));
    return;
  }
  for (const c of cases) {
    const slug = slugify(c.title);
    const file = join(outDir, `TC-${c.id}-${slug}.spec.ts`);
    const code = framework === 'cypress' ? renderCypress(c) : renderPlaywright(c);
    await writeFile(file, code, 'utf8');
    console.log(chalk.green(`✓ ${file}`));
  }
  console.log(chalk.gray(`Generated ${cases.length} ${framework} scaffold(s)`));
}

interface LoadedCase {
  id: number;
  title: string;
  priority: number;
  tags: string[];
  steps: Array<{ action: string; expected: string }>;
}

async function loadTestCases(outputDir: string, ids: number[], suiteId: number | null): Promise<LoadedCase[]> {
  const out: LoadedCase[] = [];
  const entries = await readdir(outputDir, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.startsWith('TC-') || !e.name.endsWith('.md')) continue;
    const parent = (e as { parentPath?: string; path?: string }).parentPath ??
      (e as { parentPath?: string; path?: string }).path ?? outputDir;
    const text = await readFile(join(parent, e.name), 'utf8');
    const parsed = matter(text);
    const id = Number(parsed.data.id ?? 0);
    if (ids.length && !ids.includes(id)) continue;
    const suiteIds = Array.isArray(parsed.data.suiteIds) ? (parsed.data.suiteIds as number[]) : [];
    if (suiteId !== null && !suiteIds.includes(suiteId)) continue;
    out.push({
      id,
      title: String(parsed.data.title ?? ''),
      priority: Number(parsed.data.priority ?? 3),
      tags: Array.isArray(parsed.data.tags) ? (parsed.data.tags as string[]) : [],
      steps: extractSteps(parsed.content),
    });
  }
  return out;
}

function extractSteps(body: string): Array<{ action: string; expected: string }> {
  const out: Array<{ action: string; expected: string }> = [];
  const re = /### Step \d+[\s\S]*?\*\*Action:\*\*\s*([\s\S]*?)(?=\n\*\*Expected|\n### Step|\n## |$)(?:\n\*\*Expected:\*\*\s*([\s\S]*?)(?=\n### Step|\n## |$))?/g;
  for (const m of body.matchAll(re)) {
    out.push({ action: (m[1] ?? '').trim(), expected: (m[2] ?? '').trim() });
  }
  return out;
}

function renderPlaywright(c: LoadedCase): string {
  const tags = c.tags.length ? ` { tag: [${c.tags.map((t) => `'@${t}'`).join(', ')}] }` : '';
  const steps = c.steps
    .map(
      (s, i) =>
        `  await test.step('Step ${i + 1}: ${escape(s.action.slice(0, 80))}', async () => {\n` +
        `    // TODO: ${escape(s.action)}\n` +
        (s.expected ? `    // expected: ${escape(s.expected)}\n` : '') +
        `  });`,
    )
    .join('\n');
  return `import { test, expect } from '@playwright/test';

// Auto-generated scaffold for TC-${c.id} (P${c.priority})
// ${c.title}
test('TC-${c.id} ${escape(c.title)}',${tags} async ({ page }) => {
${steps}
});
`;
}

function renderCypress(c: LoadedCase): string {
  const steps = c.steps
    .map(
      (s, i) =>
        `  it.skip('Step ${i + 1}: ${escape(s.action.slice(0, 80))}', () => {\n` +
        `    // TODO: ${escape(s.action)}\n` +
        (s.expected ? `    // expected: ${escape(s.expected)}\n` : '') +
        `  });`,
    )
    .join('\n');
  return `// Auto-generated scaffold for TC-${c.id} (P${c.priority})
describe('TC-${c.id} ${escape(c.title)}', () => {
${steps}
});
`;
}

function escape(s: string): string {
  return s.replace(/'/g, "\\'").replace(/\n/g, ' ');
}
