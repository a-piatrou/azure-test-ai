import chalk from 'chalk';
import { loadConfig } from '../../core/config.js';
import { TestCaseVersioning } from '../../version/git-versioning.js';

export interface VersionLogOpts {
  config?: string;
  limit?: string;
}

export async function runVersionLog(opts: VersionLogOpts): Promise<void> {
  const loaded = await loadConfig(opts.config);
  if (!loaded.config.git.enabled) {
    console.log(chalk.yellow('Git versioning is disabled in .testcasesync.json (git.enabled = false).'));
    return;
  }
  const v = new TestCaseVersioning(loaded.config.outputDir);
  const log = await v.history(Number(opts.limit ?? 20));
  for (const entry of log) {
    console.log(`${chalk.cyan(entry.hash.slice(0, 7))}  ${entry.date}  ${entry.message.split('\n')[0]}`);
  }
}
