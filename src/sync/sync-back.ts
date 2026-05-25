import matter from 'gray-matter';
import { readFile } from 'node:fs/promises';
import type { AdoClient } from '../core/ado-client.js';
import { ApiError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { TestCase, TestStep } from '../core/types.js';

export interface SyncBackPlan {
  testCaseId: number;
  projectName: string;
  remoteRev: number;
  localRev: number;
  /** True if remote rev moved past the rev we synced. We do NOT push in this case. */
  conflict: boolean;
  patches: Array<{ op: string; path: string; value: unknown }>;
}

export interface SyncBackResult {
  applied: number;
  skipped: number;
  conflicts: number;
  errors: Array<{ id: number; message: string }>;
  details: SyncBackPlan[];
}

export interface SyncBackOptions {
  execute: boolean; // false = dry run (default)
}

export class SyncBackEngine {
  constructor(
    private readonly client: AdoClient,
    private readonly projectName: string,
  ) {}

  async planFromMarkdown(markdownPath: string): Promise<SyncBackPlan> {
    const text = await readFile(markdownPath, 'utf8');
    const parsed = matter(text);
    const data = parsed.data as Record<string, unknown>;
    const id = Number(data.id);
    const localRev = Number(data.rev);
    if (!id || Number.isNaN(localRev)) {
      throw new Error(`Markdown missing valid id/rev frontmatter: ${markdownPath}`);
    }

    const remote = (await this.client.getTestCases(this.projectName, [id]))[0];
    if (!remote) throw new Error(`Test case ${id} not found in Azure DevOps`);

    const conflict = remote.rev !== localRev;

    const local = this.parseMarkdownToFields(parsed.content, data, remote);
    const patches = this.buildPatches(remote, local);

    return {
      testCaseId: id,
      projectName: this.projectName,
      remoteRev: remote.rev,
      localRev,
      conflict,
      patches,
    };
  }

  async execute(plans: SyncBackPlan[], opts: SyncBackOptions): Promise<SyncBackResult> {
    const result: SyncBackResult = {
      applied: 0,
      skipped: 0,
      conflicts: 0,
      errors: [],
      details: plans,
    };
    for (const p of plans) {
      if (p.conflict) {
        result.conflicts++;
        logger.warn(
          { id: p.testCaseId, remote: p.remoteRev, local: p.localRev },
          'Conflict: remote rev differs from local; skipping. Re-sync and re-apply review first.',
        );
        continue;
      }
      if (!p.patches.length) {
        result.skipped++;
        continue;
      }
      if (!opts.execute) {
        logger.info({ id: p.testCaseId, patches: p.patches.length }, 'Dry-run: would patch');
        continue;
      }
      try {
        await this.client.patchTestCase(this.projectName, p.testCaseId, p.patches, p.localRev);
        result.applied++;
      } catch (err) {
        if (err instanceof ApiError && err.status === 412) {
          result.conflicts++;
        } else {
          result.errors.push({ id: p.testCaseId, message: (err as Error).message });
        }
      }
    }
    return result;
  }

  private parseMarkdownToFields(
    body: string,
    data: Record<string, unknown>,
    remote: TestCase,
  ): Partial<TestCase> {
    const title = data.title as string | undefined;
    const tags = Array.isArray(data.tags) ? (data.tags as string[]) : undefined;
    const description = this.extractSection(body, 'Description');
    const preconditions = this.extractSection(body, 'Preconditions');

    // Re-derive steps from body. We rely on the renderer's stable format.
    const steps = this.extractSteps(body, remote.steps);
    return { title, tags, description, preconditions, steps };
  }

  private extractSection(body: string, name: string): string | undefined {
    const re = new RegExp(`##\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
    const m = re.exec(body);
    if (!m || !m[1]) return undefined;
    return m[1].trim();
  }

  private extractSteps(body: string, remoteSteps: TestStep[]): TestStep[] {
    // Parse each `### Step N` block. Preserve shared step references unchanged
    // (we don't allow modifying shared step contents via local edits).
    const stepBlockRe = /### Step (\d+)(?: — _shared:[^\n]+| — \[shared[^\n]+)?\s*\n([\s\S]*?)(?=\n### Step \d+|\n## |$)/gi;
    const steps: TestStep[] = [];
    for (const m of body.matchAll(stepBlockRe)) {
      const n = Number(m[1]);
      const block = m[2] ?? '';
      // If the header indicated shared step, copy from remote unchanged.
      if (/_shared:|\[shared step/.test(m[0]!)) {
        const remoteStep = remoteSteps[n - 1];
        if (remoteStep) steps.push(remoteStep);
        continue;
      }
      const action = (/\*\*Action:\*\*\s*([\s\S]*?)(?:\n\*\*Expected:\*\*|$)/i.exec(block)?.[1] ?? '').trim();
      const expected = (/\*\*Expected:\*\*\s*([\s\S]*)$/i.exec(block)?.[1] ?? '').trim();
      const remoteStep = remoteSteps[n - 1];
      steps.push({
        id: remoteStep?.id ?? n,
        action,
        expected,
        isSharedStep: false,
      });
    }
    return steps;
  }

  private buildPatches(
    remote: TestCase,
    local: Partial<TestCase>,
  ): Array<{ op: string; path: string; value: unknown }> {
    const patches: Array<{ op: string; path: string; value: unknown }> = [];

    if (local.title && local.title !== remote.title) {
      patches.push({ op: 'replace', path: '/fields/System.Title', value: local.title });
    }
    if (local.tags) {
      const newTags = local.tags.join('; ');
      const oldTags = remote.tags.join('; ');
      if (newTags !== oldTags) {
        patches.push({ op: 'replace', path: '/fields/System.Tags', value: newTags });
      }
    }
    if (local.description !== undefined && local.description !== (remote.description ?? '')) {
      patches.push({ op: 'replace', path: '/fields/System.Description', value: local.description });
    }
    if (
      local.preconditions !== undefined &&
      local.preconditions !== (remote.preconditions ?? '')
    ) {
      patches.push({
        op: 'replace',
        path: '/fields/Microsoft.VSTS.Common.Preconditions',
        value: local.preconditions,
      });
    }
    if (local.steps) {
      const xml = stepsToXml(local.steps);
      const remoteXml = (remote.fields['Microsoft.VSTS.TCM.Steps'] as string | undefined) ?? '';
      if (normalizeXml(xml) !== normalizeXml(remoteXml)) {
        patches.push({
          op: 'replace',
          path: '/fields/Microsoft.VSTS.TCM.Steps',
          value: xml,
        });
      }
    }
    return patches;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stepsToXml(steps: TestStep[]): string {
  const inner = steps
    .map((s, idx) => {
      const id = s.id || idx + 1;
      if (s.isSharedStep && s.sharedStepId) {
        return `<compref id="${id}" ref="${s.sharedStepId}"></compref>`;
      }
      const action = escapeXml(s.action || '');
      const expected = escapeXml(s.expected || '');
      return (
        `<step id="${id}" type="ActionStep">` +
        `<parameterizedString isformatted="true">${action}</parameterizedString>` +
        `<parameterizedString isformatted="true">${expected}</parameterizedString>` +
        `<description/>` +
        `</step>`
      );
    })
    .join('');
  return `<steps id="0" last="${steps.length}">${inner}</steps>`;
}

function normalizeXml(xml: string): string {
  return xml.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
}
