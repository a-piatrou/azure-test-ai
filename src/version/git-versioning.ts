import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { logger } from '../core/logger.js';
import type { SyncResult } from '../core/types.js';
import type { Config } from '../core/config-schema.js';

export class TestCaseVersioning {
  private readonly git: SimpleGit;
  private readonly outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
    this.git = simpleGit({ baseDir: outputDir });
  }

  async ensureInitialized(): Promise<void> {
    if (!existsSync(join(this.outputDir, '.git'))) {
      logger.info({ dir: this.outputDir }, 'Initializing git repo for test cases');
      await this.git.init();
      await this.git.addConfig('user.name', 'azure-test-sync', false, 'local');
      await this.git.addConfig('user.email', 'test-sync@local', false, 'local');
    }
  }

  async commitSync(result: SyncResult, organization: string): Promise<string | null> {
    await this.ensureInitialized();
    await this.git.add(['-A']);
    const status = await this.git.status();
    if (status.files.length === 0) {
      logger.debug('No changes to commit');
      return null;
    }
    const subject = this.formatCommitMessage(result, organization);
    const body = this.formatCommitBody(result);
    const message = body ? `${subject}\n\n${body}` : subject;
    const commit = await this.git.commit(message);
    logger.info({ commit: commit.commit }, 'Committed sync');
    return commit.commit;
  }

  async history(limit = 20): Promise<Array<{ hash: string; date: string; message: string }>> {
    await this.ensureInitialized();
    const log = await this.git.log({ maxCount: limit });
    return log.all.map((c) => ({ hash: c.hash, date: c.date, message: c.message }));
  }

  async showAtRevision(testCaseId: number, commit: string): Promise<string | null> {
    try {
      const files = await this.git.raw(['ls-tree', '-r', '--name-only', commit]);
      const target = files
        .split('\n')
        .map((s) => s.trim())
        .find((f) => f.includes(`TC-${testCaseId}-`) && f.endsWith('.md'));
      if (!target) return null;
      return await this.git.show([`${commit}:${target}`]);
    } catch (err) {
      logger.debug({ err, testCaseId, commit }, 'showAtRevision failed');
      return null;
    }
  }

  async diffTestCase(
    testCaseId: number,
    from: string,
    to = 'HEAD',
  ): Promise<string> {
    await this.ensureInitialized();
    const log = await this.git.log({ file: undefined, maxCount: 1 });
    if (!log.latest) return '';
    return this.git.diff([`${from}..${to}`, '--', `**/TC-${testCaseId}-*.md`]);
  }

  private formatCommitMessage(r: SyncResult, organization: string): string {
    const parts: string[] = [];
    if (r.added.length) parts.push(`+${r.added.length} new`);
    if (r.updated.length) parts.push(`~${r.updated.length} updated`);
    if (r.deleted.length) parts.push(`-${r.deleted.length} deleted`);
    const summary = parts.length ? parts.join(', ') : 'no changes';
    return `sync(${organization}): ${summary}`;
  }

  private formatCommitBody(r: SyncResult): string {
    const lines: string[] = [];
    if (r.added.length) lines.push(`Added: ${r.added.slice(0, 20).join(', ')}${r.added.length > 20 ? '…' : ''}`);
    if (r.updated.length) lines.push(`Updated: ${r.updated.slice(0, 20).join(', ')}${r.updated.length > 20 ? '…' : ''}`);
    if (r.deleted.length) lines.push(`Deleted: ${r.deleted.slice(0, 20).join(', ')}${r.deleted.length > 20 ? '…' : ''}`);
    if (r.errors.length) lines.push(`Errors: ${r.errors.length}`);
    lines.push(`Duration: ${r.durationMs}ms`);
    return lines.join('\n');
  }
}

export async function maybeCommit(
  config: Config,
  result: SyncResult,
): Promise<string | null> {
  if (!config.git.enabled || !config.git.autoCommit) return null;
  const versioning = new TestCaseVersioning(config.outputDir);
  return versioning.commitSync(result, config.organization);
}
