import chalk from 'chalk';
import { loadConfig, describeConfig } from '../../core/config.js';
import { AdoClient } from '../../core/ado-client.js';
import { ApiError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

export interface ValidateOpts {
  config?: string;
  verbose?: boolean;
}

export async function runValidate(opts: ValidateOpts): Promise<void> {
  if (opts.verbose) logger.level = 'debug';
  const loaded = await loadConfig(opts.config);
  console.log(chalk.bold('Configuration:'));
  console.log(describeConfig(loaded));
  console.log();

  console.log(chalk.bold('Testing connection...'));
  const client = new AdoClient({
    organization: loaded.config.organization,
    pat: loaded.pat,
    apiVersion: loaded.config.apiVersion,
  });
  try {
    const conn = await client.ping();
    console.log(chalk.green(`✓ Connected as ${conn.user}`));
  } catch (err) {
    console.log(chalk.red(`✗ Connection failed: ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  for (const project of loaded.config.projects) {
    console.log(chalk.bold(`\nProject: ${project.name}`));
    try {
      const plans = project.planIds.length
        ? await Promise.all(project.planIds.map((id) => client.getPlan(project.name, id)))
        : await client.listPlans(project.name);
      console.log(chalk.green(`  ✓ ${plans.length} plan(s) accessible`));
      for (const p of plans.slice(0, 5)) {
        console.log(`    - #${p.id} ${p.name} (${p.state})`);
      }
      if (plans.length > 5) console.log(`    ... and ${plans.length - 5} more`);
    } catch (err) {
      if (err instanceof ApiError) {
        console.log(chalk.red(`  ✗ ${err.message}`));
        if (err.hint) console.log(chalk.gray(`    hint: ${err.hint}`));
      } else {
        console.log(chalk.red(`  ✗ ${(err as Error).message}`));
      }
      process.exitCode = 1;
    }
  }
}
