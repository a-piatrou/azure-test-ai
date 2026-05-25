import chalk from 'chalk';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { loadConfig } from '../../core/config.js';
import { AdoClient } from '../../core/ado-client.js';
import { SyncBackEngine, type SyncBackPlan } from '../../sync/sync-back.js';
import { findTestCaseMarkdownById, loadReview, saveReview } from '../../review/reviewer.js';

export interface SyncBackCliOpts {
  config?: string;
  id?: string;
  suite?: string;
  dryRun?: boolean;
  execute?: boolean;
}

export async function runSyncBack(opts: SyncBackCliOpts): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const ids = await resolveIds(loaded.config.outputDir, opts);
  if (!ids.length) {
    console.log(chalk.yellow('No targets. Use --id or --suite.'));
    return;
  }
  const execute = !!opts.execute && !opts.dryRun;
  const dryRun = !execute;
  console.log(chalk.bold(dryRun ? '[DRY-RUN] sync-back' : 'sync-back EXECUTE'));

  const tcToProject = await mapTcToProject(loaded.config.outputDir);
  const byProject = new Map<string, number[]>();
  for (const id of ids) {
    const project = tcToProject.get(id);
    if (!project) {
      console.log(chalk.red(`  ✗ TC-${id}: no project mapping (sync first)`));
      continue;
    }
    const list = byProject.get(project) ?? [];
    list.push(id);
    byProject.set(project, list);
  }

  for (const [projectName, projectIds] of byProject) {
    const client = new AdoClient({
      organization: loaded.config.organization,
      pat: loaded.pat,
      apiVersion: loaded.config.apiVersion,
    });
    const engine = new SyncBackEngine(client, projectName);
    const plans: SyncBackPlan[] = [];
    for (const id of projectIds) {
      const path = await findTestCaseMarkdownById(loaded.config.outputDir, id);
      if (!path) continue;
      try {
        const plan = await engine.planFromMarkdown(path);
        plans.push(plan);
      } catch (err) {
        console.log(chalk.red(`  ✗ TC-${id}: ${(err as Error).message}`));
      }
    }

    console.log(chalk.bold(`\n  Project ${projectName} (${plans.length} plan(s)):`));
    for (const p of plans) {
      if (p.conflict) {
        console.log(
          chalk.yellow(
            `    ⚠ TC-${p.testCaseId}: CONFLICT — remote rev ${p.remoteRev} ≠ local rev ${p.localRev}. Re-sync first.`,
          ),
        );
        continue;
      }
      if (!p.patches.length) {
        console.log(chalk.gray(`    · TC-${p.testCaseId}: no changes`));
        continue;
      }
      console.log(
        `    ${dryRun ? chalk.cyan('?') : chalk.green('→')} TC-${p.testCaseId}: ${p.patches.length} patch(es)` +
          (dryRun ? ` (paths: ${p.patches.map((q) => q.path.split('/').pop()).join(', ')})` : ''),
      );
    }

    const result = await engine.execute(plans, { execute });
    console.log(
      chalk.gray(
        `    applied=${result.applied} skipped=${result.skipped} conflicts=${result.conflicts} errors=${result.errors.length}`,
      ),
    );

    if (execute) {
      // Stamp review files with syncedBackAt for successfully applied cases
      const appliedIds = plans
        .filter((p) => !p.conflict && p.patches.length)
        .map((p) => p.testCaseId);
      for (const id of appliedIds) {
        const path = await findTestCaseMarkdownById(loaded.config.outputDir, id);
        if (!path) continue;
        const review = await loadReview(path);
        if (review) {
          review.syncedBackAt = new Date().toISOString();
          await saveReview(review, path);
        }
      }
    }
  }
}

async function resolveIds(outputDir: string, opts: SyncBackCliOpts): Promise<number[]> {
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

async function mapTcToProject(outputDir: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const state = await import('../../core/sync-state.js').then((m) => m.loadSyncState(outputDir));
  if (state) {
    for (const [projectName, project] of Object.entries(state.projects)) {
      for (const idStr of Object.keys(project.testCases)) {
        map.set(Number(idStr), projectName);
      }
    }
  }
  return map;
}
