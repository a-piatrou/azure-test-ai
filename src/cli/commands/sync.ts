import ora from 'ora';
import chalk from 'chalk';
import { loadConfig } from '../../core/config.js';
import { AdoClient } from '../../core/ado-client.js';
import { SyncEngine } from '../../sync/sync-engine.js';
import { maybeCommit } from '../../version/git-versioning.js';
import { formatSyncResultText } from '../formatters.js';
import { setVerbose, logger } from '../../core/logger.js';

export interface SyncCliOpts {
  config?: string;
  full?: boolean;
  dryRun?: boolean;
  skipValidation?: boolean;
  plan?: string;
  suite?: string;
  format?: 'text' | 'json';
  verbose?: boolean;
}

export async function runSync(opts: SyncCliOpts): Promise<void> {
  setVerbose(!!opts.verbose);
  const loaded = await loadConfig(opts.config);
  const client = new AdoClient({
    organization: loaded.config.organization,
    pat: loaded.pat,
    apiVersion: loaded.config.apiVersion,
  });

  if (!opts.skipValidation) {
    try {
      await client.ping();
    } catch (err) {
      console.error(chalk.red(`Connection failed: ${(err as Error).message}`));
      console.error(chalk.gray('Run `validate` for details, or pass --skip-validation to bypass'));
      process.exit(1);
    }
  }

  const engine = new SyncEngine(client, loaded.config);
  const planIds = opts.plan?.split(',').map((s) => Number(s.trim())).filter(Boolean);
  const suiteIds = opts.suite?.split(',').map((s) => Number(s.trim())).filter(Boolean);

  const spinner = opts.format === 'json' ? null : ora('Syncing test cases...').start();
  try {
    const result = await engine.run({
      full: opts.full,
      dryRun: opts.dryRun,
      planIdsOverride: planIds,
      suiteIdsOverride: suiteIds,
    });
    spinner?.stop();

    const commitHash = !opts.dryRun ? await maybeCommit(loaded.config, result).catch((err) => {
      logger.warn({ err }, 'Git auto-commit failed (continuing)');
      return null;
    }) : null;

    if (opts.format === 'json') {
      console.log(JSON.stringify({ ...result, commit: commitHash }, null, 2));
    } else {
      console.log(formatSyncResultText(result, loaded.config.organization));
      if (commitHash) console.log(`  ${chalk.gray('⎇')} commit:    ${commitHash}`);
    }

    if (result.errors.length) process.exitCode = 2;
  } catch (err) {
    spinner?.fail((err as Error).message);
    throw err;
  }
}
