import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { DEFAULT_CONFIG_PATH } from '../../core/config.js';

const TEMPLATE = {
  organization: 'YOUR_ORG_HERE',
  projects: [
    {
      name: 'YOUR_PROJECT_HERE',
      planIds: [],
      suiteIds: [],
      areaPath: '',
      tags: [],
    },
  ],
  outputDir: './test-cases',
  downloadAttachments: true,
  maxAttachmentSize: 10485760,
  incrementalSync: true,
  concurrency: 5,
  apiVersion: '7.1',
  inlineSharedSteps: true,
  pruneDeleted: false,
  git: { enabled: false, autoCommit: true },
  review: { model: 'claude-opus-4-7', capturePlaywrightTrace: true },
  quality: { minStepCount: 2, useLlm: false },
};

export async function runInit(output: string = DEFAULT_CONFIG_PATH): Promise<void> {
  const target = resolve(output);
  if (existsSync(target)) {
    console.error(chalk.red(`Config already exists: ${target}`));
    process.exit(1);
  }
  await writeFile(target, JSON.stringify(TEMPLATE, null, 2) + '\n', 'utf8');
  console.log(chalk.green(`✓ Created ${target}`));
  console.log(chalk.gray('Next steps:'));
  console.log('  1. cp .env.example .env  (then paste your PAT)');
  console.log(`  2. Edit ${output} — set organization and project names`);
  console.log('  3. Run: npx tsx src/index.ts validate');
  console.log('  4. Run: npx tsx src/index.ts sync --dry-run');
}
