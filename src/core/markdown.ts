import matter from 'gray-matter';
import type { TestCase, TestSuite, TestPlan, SharedStep, TestStep } from './types.js';

export interface RenderOptions {
  inlineSharedSteps: boolean;
  sharedSteps?: Map<number, SharedStep>;
  attachmentsBaseDir?: string;
}

export function renderTestCase(tc: TestCase, opts: RenderOptions): string {
  const frontmatter = {
    id: tc.id,
    rev: tc.rev,
    title: tc.title,
    state: tc.state,
    priority: tc.priority,
    areaPath: tc.areaPath,
    iterationPath: tc.iterationPath,
    tags: tc.tags,
    assignedTo: tc.assignedTo,
    automationStatus: tc.automationStatus,
    automatedTestName: tc.automatedTestName,
    createdDate: tc.createdDate,
    changedDate: tc.changedDate,
    changedBy: tc.changedBy,
    planIds: tc.planIds,
    suiteIds: tc.suiteIds,
  };

  const sections: string[] = [];
  sections.push(`# ${tc.title}\n`);
  sections.push(`> **ID:** ${tc.id} · **Rev:** ${tc.rev} · **Priority:** ${tc.priority} · **State:** ${tc.state}\n`);

  if (tc.description?.trim()) {
    sections.push(`## Description\n\n${stripHtmlToMarkdown(tc.description)}\n`);
  }

  if (tc.preconditions?.trim()) {
    sections.push(`## Preconditions\n\n${stripHtmlToMarkdown(tc.preconditions)}\n`);
  }

  sections.push(`## Steps\n\n${renderSteps(tc.steps, opts)}`);

  if (tc.attachments.length) {
    sections.push(`## Attachments\n\n${renderAttachments(tc)}`);
  }

  const body = sections.join('\n');
  return matter.stringify(body, dropUndefined(frontmatter));
}

export function renderSharedStep(ss: SharedStep): string {
  const frontmatter = {
    id: ss.id,
    rev: ss.rev,
    title: ss.title,
    changedDate: ss.changedDate,
  };
  const body = [
    `# ${ss.title}`,
    '',
    `> **Shared Step ID:** ${ss.id} · **Rev:** ${ss.rev}`,
    '',
    '## Steps',
    '',
    renderSteps(ss.steps, { inlineSharedSteps: false }),
  ].join('\n');
  return matter.stringify(body, dropUndefined(frontmatter));
}

function dropUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export function renderSuiteIndex(
  suite: TestSuite,
  plan: TestPlan,
  testCases: TestCase[],
): string {
  const fm = dropUndefined({
    id: suite.id,
    name: suite.name,
    planId: suite.planId,
    planName: plan.name,
    parentSuiteId: suite.parentSuiteId,
    suiteType: suite.suiteType,
    testCaseCount: testCases.length,
  });
  const rows = testCases
    .slice()
    .sort((a, b) => a.priority - b.priority || a.id - b.id)
    .map(
      (tc) =>
        `| ${tc.id} | P${tc.priority} | ${escapeMd(tc.title)} | ${tc.state} | ${tc.automationStatus ?? '-'} |`,
    );
  const body = [
    `# Suite: ${suite.name}`,
    '',
    `Plan: **${plan.name}** (#${plan.id})  `,
    `Type: ${suite.suiteType}  `,
    `Test cases: ${testCases.length}`,
    '',
    '| ID | Pri | Title | State | Automation |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
  return matter.stringify(body, fm);
}

export function renderPlanIndex(plan: TestPlan, suites: TestSuite[]): string {
  const fm = dropUndefined({
    id: plan.id,
    name: plan.name,
    state: plan.state,
    startDate: plan.startDate,
    endDate: plan.endDate,
    suiteCount: suites.length,
  });
  const rows = suites.map(
    (s) => `| ${s.id} | ${escapeMd(s.name)} | ${s.suiteType} | ${s.testCaseCount} |`,
  );
  const body = [
    `# Plan: ${plan.name}`,
    '',
    plan.description ? stripHtmlToMarkdown(plan.description) : '',
    '',
    `State: ${plan.state}  `,
    plan.startDate ? `Start: ${plan.startDate}  ` : '',
    plan.endDate ? `End: ${plan.endDate}` : '',
    '',
    '## Suites',
    '',
    '| ID | Name | Type | Cases |',
    '|---|---|---|---|',
    ...rows,
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');
  return matter.stringify(body, fm);
}

function renderSteps(steps: TestStep[], opts: RenderOptions): string {
  if (!steps.length) return '_(no steps)_\n';
  const lines: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const n = i + 1;
    if (step.isSharedStep && step.sharedStepId !== undefined) {
      const ss = opts.sharedSteps?.get(step.sharedStepId);
      if (opts.inlineSharedSteps && ss) {
        lines.push(`### Step ${n} — _shared: ${ss.title}_ (#${step.sharedStepId})`);
        lines.push('');
        for (let j = 0; j < ss.steps.length; j++) {
          const sub = ss.steps[j]!;
          lines.push(`${n}.${j + 1}. **Action:** ${sub.action || '_(empty)_'}`);
          if (sub.expected) lines.push(`   **Expected:** ${sub.expected}`);
        }
      } else {
        lines.push(`### Step ${n} — [shared step #${step.sharedStepId}](../shared-steps/SS-${step.sharedStepId}.md)`);
      }
      lines.push('');
      continue;
    }
    lines.push(`### Step ${n}`);
    lines.push('');
    lines.push(`**Action:** ${step.action || '_(empty)_'}`);
    if (step.expected) lines.push(`**Expected:** ${step.expected}`);
    lines.push('');
  }
  return lines.join('\n');
}

function renderAttachments(tc: TestCase): string {
  return tc.attachments
    .map((a) => {
      if (a.localPath) {
        const rel = `attachments/TC-${tc.id}/${a.name}`;
        return `- [${escapeMd(a.name)}](${encodeURI(rel)})${a.size ? ` (${formatBytes(a.size)})` : ''}`;
      }
      return `- ${escapeMd(a.name)} (not downloaded${a.size ? `, ${formatBytes(a.size)}` : ''})`;
    })
    .join('\n');
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function stripHtmlToMarkdown(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<strong>([^<]*)<\/strong>/gi, '**$1**')
    .replace(/<b>([^<]*)<\/b>/gi, '**$1**')
    .replace(/<em>([^<]*)<\/em>/gi, '_$1_')
    .replace(/<i>([^<]*)<\/i>/gi, '_$1_')
    .replace(/<li>([^<]*)<\/li>/gi, '- $1\n')
    .replace(/<\/?ul[^>]*>/gi, '')
    .replace(/<\/?ol[^>]*>/gi, '')
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, '[$2]($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseTestCaseMarkdown(content: string): { data: Record<string, unknown>; content: string } {
  const parsed = matter(content);
  return { data: parsed.data, content: parsed.content };
}

/**
 * Stable hash for change detection — frontmatter excludes mutable metadata
 * (changedDate, rev, etc.) so we only re-write files when content actually changes.
 */
export function contentHashOf(tc: TestCase, opts: RenderOptions): string {
  const obj = {
    title: tc.title,
    state: tc.state,
    priority: tc.priority,
    areaPath: tc.areaPath,
    tags: [...tc.tags].sort(),
    description: tc.description ?? '',
    preconditions: tc.preconditions ?? '',
    steps: tc.steps.map((s) => ({
      action: s.action,
      expected: s.expected,
      sharedStepId: s.sharedStepId,
    })),
    inlineSharedSteps: opts.inlineSharedSteps,
  };
  const json = JSON.stringify(obj);
  let h = 5381;
  for (let i = 0; i < json.length; i++) {
    h = ((h * 33) ^ json.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
