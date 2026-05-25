import chalk from 'chalk';
import { loadConfig } from '../../core/config.js';
import { loadSyncState } from '../../core/sync-state.js';

export interface StatusOpts {
  config?: string;
}

export async function runStatus(opts: StatusOpts): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const state = await loadSyncState(loaded.config.outputDir);
  if (!state) {
    console.log(chalk.yellow('No sync state found.'));
    console.log(chalk.gray(`Expected: ${loaded.config.outputDir}/.sync-state.json`));
    console.log(chalk.gray('Run `sync` to generate it.'));
    return;
  }
  console.log(chalk.bold('Sync Status'));
  console.log(`  Organization: ${state.organization}`);
  console.log(`  Last sync:    ${state.lastSyncAt}`);
  console.log(`  Output dir:   ${loaded.config.outputDir}`);
  console.log();
  for (const [name, project] of Object.entries(state.projects)) {
    const tcCount = Object.keys(project.testCases).length;
    const ssCount = Object.keys(project.sharedSteps).length;
    const planCount = Object.keys(project.plans).length;
    const suiteCount = Object.keys(project.suites).length;
    console.log(chalk.bold(`  ${name}`));
    console.log(`    Test cases:   ${tcCount}`);
    console.log(`    Shared steps: ${ssCount}`);
    console.log(`    Plans:        ${planCount}`);
    console.log(`    Suites:       ${suiteCount}`);
  }
}
