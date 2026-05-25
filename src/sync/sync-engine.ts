import pLimit from 'p-limit';
import { AdoClient } from '../core/ado-client.js';
import { logger } from '../core/logger.js';
import { renderTestCase, renderSuiteIndex, renderPlanIndex, renderSharedStep, contentHashOf } from '../core/markdown.js';
import {
  attachmentsDir,
  planDir,
  projectDir,
  sharedStepFile,
  suiteDir,
  testCaseFile,
} from '../core/paths.js';
import { writeFileEnsured, safeDelete, safeDeleteDir, relativeFrom } from '../core/fs-utils.js';
import { loadSyncState, saveSyncState, emptySyncState } from '../core/sync-state.js';
import type { Config, ProjectConfig } from '../core/config-schema.js';
import type {
  SharedStep,
  SyncError,
  SyncResult,
  SyncState,
  TestCase,
  TestPlan,
  TestSuite,
} from '../core/types.js';
import { ApiError } from '../core/errors.js';
import { join } from 'node:path';

export interface SyncOptions {
  full?: boolean;
  dryRun?: boolean;
  planIdsOverride?: number[];
  suiteIdsOverride?: number[];
}

export class SyncEngine {
  constructor(
    private readonly client: AdoClient,
    private readonly config: Config,
  ) {}

  async run(opts: SyncOptions = {}): Promise<SyncResult> {
    const started = Date.now();
    const errors: SyncError[] = [];
    const added: number[] = [];
    const updated: number[] = [];
    const unchanged: number[] = [];
    const deleted: number[] = [];

    const state: SyncState = opts.full
      ? emptySyncState(this.config.organization)
      : (await loadSyncState(this.config.outputDir)) ?? emptySyncState(this.config.organization);

    for (const project of this.config.projects) {
      logger.info({ project: project.name }, 'Syncing project');
      try {
        const projectResult = await this.syncProject(project, state, opts);
        added.push(...projectResult.added);
        updated.push(...projectResult.updated);
        unchanged.push(...projectResult.unchanged);
        deleted.push(...projectResult.deleted);
        errors.push(...projectResult.errors);
      } catch (err) {
        logger.error({ err, project: project.name }, 'Project sync failed');
        errors.push({
          stage: 'list',
          message: `Project "${project.name}": ${(err as Error).message}`,
          cause: err,
        });
      }
    }

    state.lastSyncAt = new Date().toISOString();
    if (!opts.dryRun) await saveSyncState(this.config.outputDir, state);

    return {
      added,
      updated,
      unchanged,
      deleted,
      errors,
      durationMs: Date.now() - started,
      dryRun: !!opts.dryRun,
    };
  }

  private async syncProject(
    project: ProjectConfig,
    state: SyncState,
    opts: SyncOptions,
  ): Promise<SyncResult> {
    const ctx = { outputDir: this.config.outputDir, projectName: project.name };
    const limit = pLimit(this.config.concurrency);
    const errors: SyncError[] = [];
    const added: number[] = [];
    const updated: number[] = [];
    const unchanged: number[] = [];
    const deleted: number[] = [];

    if (!state.projects[project.name]) {
      state.projects[project.name] = {
        testCases: {},
        sharedSteps: {},
        plans: {},
        suites: {},
      };
    }
    const projectState = state.projects[project.name]!;

    // 1. Resolve plans
    const planIds = opts.planIdsOverride?.length
      ? opts.planIdsOverride
      : project.planIds.length
        ? project.planIds
        : (await this.client.listPlans(project.name)).map((p) => p.id);

    logger.debug({ planIds, project: project.name }, 'Resolved plan IDs');

    const allTestCaseIds = new Map<number, { planId: number; suiteId: number }[]>();
    const planMap = new Map<number, TestPlan>();
    const suiteMap = new Map<number, TestSuite>();

    for (const planId of planIds) {
      let plan: TestPlan;
      try {
        plan = await this.client.getPlan(project.name, planId);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          errors.push({ stage: 'list', message: `Plan ${planId} not found in ${project.name}` });
          continue;
        }
        throw err;
      }
      planMap.set(planId, plan);

      const suites = await this.client.listSuites(project.name, planId);
      const allowedSuites =
        opts.suiteIdsOverride?.length
          ? opts.suiteIdsOverride
          : project.suiteIds.length
            ? project.suiteIds
            : null;

      const filteredSuites = allowedSuites
        ? suites.filter((s) => allowedSuites.includes(s.id))
        : suites;

      for (const s of filteredSuites) {
        suiteMap.set(s.id, s);
        const ids = await this.client.listTestCaseIdsInSuite(project.name, planId, s.id);
        for (const tcId of ids) {
          const entry = allTestCaseIds.get(tcId) ?? [];
          entry.push({ planId, suiteId: s.id });
          allTestCaseIds.set(tcId, entry);
        }
      }
    }

    if (!allTestCaseIds.size) {
      logger.warn({ project: project.name }, 'No test cases matched filters');
    }

    // 2. Fetch and render test cases
    const tcIds = [...allTestCaseIds.keys()];
    let testCases = await this.client.getTestCases(project.name, tcIds);

    // Apply area/tag filters client-side
    testCases = testCases.filter((tc) => this.matchesFilters(tc, project));
    for (const tc of testCases) {
      const entries = allTestCaseIds.get(tc.id) ?? [];
      tc.suiteIds = [...new Set(entries.map((e) => e.suiteId))];
      tc.planIds = [...new Set(entries.map((e) => e.planId))];
    }

    // 3. Collect shared step IDs and fetch
    const sharedStepIds = new Set<number>();
    for (const tc of testCases) {
      for (const step of tc.steps) {
        if (step.sharedStepId) sharedStepIds.add(step.sharedStepId);
      }
    }
    const sharedSteps = sharedStepIds.size
      ? await this.client.getSharedSteps(project.name, [...sharedStepIds])
      : [];
    const sharedStepMap = new Map(sharedSteps.map((s) => [s.id, s]));

    // 4. Write shared steps
    if (!opts.dryRun) {
      await Promise.all(
        sharedSteps.map((ss) =>
          limit(async () => {
            const path = sharedStepFile(ctx, ss.id, ss.title);
            const prev = projectState.sharedSteps[ss.id];
            if (prev && prev.rev === ss.rev) return;
            const md = renderSharedStep(ss);
            await writeFileEnsured(path, md);
            projectState.sharedSteps[ss.id] = { rev: ss.rev, path: relativeFrom(this.config.outputDir, path) };
          }),
        ),
      );
    }

    // 5. Write plan/suite indexes
    if (!opts.dryRun) {
      const casesByPlan = new Map<number, TestCase[]>();
      const casesBySuite = new Map<number, TestCase[]>();
      for (const tc of testCases) {
        for (const p of tc.planIds) {
          const list = casesByPlan.get(p) ?? [];
          list.push(tc);
          casesByPlan.set(p, list);
        }
        for (const s of tc.suiteIds) {
          const list = casesBySuite.get(s) ?? [];
          list.push(tc);
          casesBySuite.set(s, list);
        }
      }
      for (const [planId, plan] of planMap) {
        const suitesForPlan = [...suiteMap.values()].filter((s) => s.planId === planId);
        const md = renderPlanIndex(plan, suitesForPlan);
        const path = join(planDir(ctx, plan.id, plan.name), '_plan.md');
        await writeFileEnsured(path, md);
        projectState.plans[planId] = { path: relativeFrom(this.config.outputDir, path) };
      }
      for (const [suiteId, suite] of suiteMap) {
        const plan = planMap.get(suite.planId);
        if (!plan) continue;
        const cases = casesBySuite.get(suiteId) ?? [];
        const md = renderSuiteIndex(suite, plan, cases);
        const path = join(suiteDir(ctx, plan.id, plan.name, suite.id, suite.name), '_suite.md');
        await writeFileEnsured(path, md);
        projectState.suites[suiteId] = {
          path: relativeFrom(this.config.outputDir, path),
          planId: suite.planId,
        };
      }
    }

    // 6. Render and write test cases
    const renderOpts = {
      inlineSharedSteps: this.config.inlineSharedSteps,
      sharedSteps: sharedStepMap,
    };

    await Promise.all(
      testCases.map((tc) =>
        limit(async () => {
          try {
            const primarySuiteId = tc.suiteIds[0];
            const primaryPlanId = tc.planIds[0];
            if (primarySuiteId === undefined || primaryPlanId === undefined) {
              logger.warn({ tcId: tc.id }, 'Test case has no suite/plan; skipping');
              return;
            }
            const plan = planMap.get(primaryPlanId);
            const suite = suiteMap.get(primarySuiteId);
            if (!plan || !suite) return;

            const filePath = testCaseFile(ctx, plan.id, plan.name, suite.id, suite.name, tc.id, tc.title);
            const hash = contentHashOf(tc, renderOpts);
            const prev = projectState.testCases[tc.id];

            if (prev && prev.rev === tc.rev && prev.hash === hash && !opts.full) {
              unchanged.push(tc.id);
              return;
            }

            // Handle attachments
            if (this.config.downloadAttachments && tc.attachments.length) {
              const attachDir = attachmentsDir(ctx, plan.id, plan.name, suite.id, suite.name, tc.id);
              for (const att of tc.attachments) {
                try {
                  if (att.size && att.size > this.config.maxAttachmentSize) {
                    logger.debug(
                      { tcId: tc.id, name: att.name, size: att.size },
                      'Skipping oversized attachment',
                    );
                    continue;
                  }
                  if (!opts.dryRun) {
                    const buf = await this.client.getAttachment(att.url);
                    const path = join(attachDir, att.name);
                    await writeFileEnsured(path, buf);
                    att.localPath = path;
                  }
                } catch (err) {
                  errors.push({
                    testCaseId: tc.id,
                    stage: 'attachment',
                    message: `Attachment ${att.name}: ${(err as Error).message}`,
                  });
                }
              }
            }

            const md = renderTestCase(tc, renderOpts);
            if (!opts.dryRun) {
              await writeFileEnsured(filePath, md);
              if (prev && prev.path && prev.path !== relativeFrom(this.config.outputDir, filePath)) {
                await safeDelete(join(this.config.outputDir, prev.path));
              }
              projectState.testCases[tc.id] = {
                rev: tc.rev,
                changedDate: tc.changedDate,
                hash,
                path: relativeFrom(this.config.outputDir, filePath),
                suiteIds: tc.suiteIds,
                planIds: tc.planIds,
              };
            }

            if (prev) updated.push(tc.id);
            else added.push(tc.id);
          } catch (err) {
            errors.push({
              testCaseId: tc.id,
              stage: 'render',
              message: (err as Error).message,
              cause: err,
            });
          }
        }),
      ),
    );

    // 7. Prune deleted
    if (this.config.pruneDeleted && !opts.dryRun) {
      const currentIds = new Set(testCases.map((tc) => tc.id));
      for (const [id, entry] of Object.entries(projectState.testCases)) {
        const numId = Number(id);
        if (!currentIds.has(numId)) {
          await safeDelete(join(this.config.outputDir, entry.path));
          await safeDeleteDir(
            join(this.config.outputDir, projectDir({ outputDir: '', projectName: project.name }).replace(/^\//, ''), 'attachments', `TC-${numId}`),
          );
          delete projectState.testCases[numId];
          deleted.push(numId);
        }
      }
    }

    return {
      added,
      updated,
      unchanged,
      deleted,
      errors,
      durationMs: 0,
      dryRun: !!opts.dryRun,
    };
  }

  private matchesFilters(tc: TestCase, project: ProjectConfig): boolean {
    if (project.areaPath && !tc.areaPath.startsWith(project.areaPath)) return false;
    if (project.tags.length) {
      const tagSet = new Set(tc.tags);
      if (!project.tags.every((t) => tagSet.has(t))) return false;
    }
    return true;
  }
}
