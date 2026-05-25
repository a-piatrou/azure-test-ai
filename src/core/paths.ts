import { join } from 'node:path';

const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g;
const TRAILING = /[. ]+$/;

export function slugify(input: string, maxLen = 60): string {
  const cleaned = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(ILLEGAL, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(TRAILING, '')
    .toLowerCase();
  if (!cleaned) return 'untitled';
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen).replace(/-$/, '') : cleaned;
}

export interface PathContext {
  outputDir: string;
  projectName: string;
}

export function projectDir(ctx: PathContext): string {
  return join(ctx.outputDir, slugify(ctx.projectName, 80));
}

export function planDir(ctx: PathContext, planId: number, planName: string): string {
  return join(projectDir(ctx), `plan-${planId}-${slugify(planName)}`);
}

export function suiteDir(
  ctx: PathContext,
  planId: number,
  planName: string,
  suiteId: number,
  suiteName: string,
): string {
  return join(planDir(ctx, planId, planName), `suite-${suiteId}-${slugify(suiteName)}`);
}

export function testCaseFile(
  ctx: PathContext,
  planId: number,
  planName: string,
  suiteId: number,
  suiteName: string,
  testCaseId: number,
  title: string,
): string {
  return join(
    suiteDir(ctx, planId, planName, suiteId, suiteName),
    `TC-${testCaseId}-${slugify(title)}.md`,
  );
}

export function attachmentsDir(
  ctx: PathContext,
  planId: number,
  planName: string,
  suiteId: number,
  suiteName: string,
  testCaseId: number,
): string {
  return join(
    suiteDir(ctx, planId, planName, suiteId, suiteName),
    'attachments',
    `TC-${testCaseId}`,
  );
}

export function sharedStepsDir(ctx: PathContext): string {
  return join(projectDir(ctx), 'shared-steps');
}

export function sharedStepFile(ctx: PathContext, id: number, title: string): string {
  return join(sharedStepsDir(ctx), `SS-${id}-${slugify(title)}.md`);
}

export function syncStateFile(outputDir: string): string {
  return join(outputDir, '.sync-state.json');
}
