#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { explainError } from './core/errors.js';
import { logger, setVerbose } from './core/logger.js';
import { runInit } from './cli/commands/init.js';
import { runValidate } from './cli/commands/validate.js';
import { runSync } from './cli/commands/sync.js';
import { runList } from './cli/commands/list.js';
import { runStatus } from './cli/commands/status.js';
import { runGenerate } from './cli/commands/generate.js';
import { runGaps } from './cli/commands/gaps.js';
import { runContext } from './cli/commands/context.js';
import { runAiReview } from './cli/commands/ai-review.js';
import { runReviewStatus } from './cli/commands/review-status.js';
import { runReviewApply } from './cli/commands/review-apply.js';
import { runSyncBack } from './cli/commands/sync-back.js';
import { runAgentDocs } from './cli/commands/agent-docs.js';
import { runMcpServer } from './cli/commands/mcp-server.js';
import { runQuality } from './cli/commands/quality.js';
import { runDedupe } from './cli/commands/dedupe.js';
import { runVersionLog } from './cli/commands/version-log.js';

const program = new Command();

program
  .name('ats')
  .description('Azure Test Sync — sync ADO test cases to markdown with AI review')
  .version('0.1.0')
  .option('--verbose', 'verbose logging')
  .hook('preAction', (cmd) => {
    if (cmd.opts().verbose) setVerbose(true);
  });

program
  .command('init')
  .description('Create .testcasesync.json scaffold')
  .option('--output <path>', 'config file path', '.testcasesync.json')
  .action(async (opts) => runInit(opts.output));

program
  .command('validate')
  .description('Validate config and ADO connectivity')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .option('--verbose', 'debug output')
  .action(async (opts) => runValidate(opts));

program
  .command('sync')
  .description('Sync test cases from Azure DevOps to markdown')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .option('--full', 'force full resync (ignore cache)')
  .option('--dry-run', 'do not write files')
  .option('--skip-validation', 'skip connectivity check')
  .option('--plan <ids>', 'comma-separated plan IDs override')
  .option('--suite <ids>', 'comma-separated suite IDs override')
  .option('--format <type>', 'output: text|json', 'text')
  .option('--verbose', 'debug output')
  .action(async (opts) => runSync(opts));

program
  .command('list')
  .description('List synced test cases')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .option('--priority <n>', 'max priority')
  .option('--suite <id>', 'filter by suite')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--format <type>', 'output: table|json|ids', 'table')
  .action(async (opts) => runList(opts));

program
  .command('status')
  .description('Show last sync summary')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .action(async (opts) => runStatus(opts));

program
  .command('generate')
  .description('Generate Playwright/Cypress scaffold files for test cases')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .option('--ids <ids>', 'comma-separated test case IDs')
  .option('--suite <id>', 'all cases in suite')
  .option('--framework <name>', 'playwright|cypress', 'playwright')
  .option('--output <dir>', 'output directory', './tests/generated')
  .action(async (opts) => runGenerate(opts));

program
  .command('gaps')
  .description('Show test cases not yet automated')
  .requiredOption('--tests-dir <path>', 'automated tests directory')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .option('--format <type>', 'table|json', 'table')
  .action(async (opts) => runGaps(opts));

program
  .command('context')
  .description('Compact context for LLMs (titles + steps)')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .option('--suite <id>', 'filter by suite')
  .option('--plan <id>', 'filter by plan')
  .option('--format <type>', 'md|json', 'md')
  .action(async (opts) => runContext(opts));

program
  .command('ai-review')
  .description('AI review of a test case (via Playwright MCP agent or static)')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .option('--id <id>', 'test case ID(s), comma-separated')
  .option('--suite <id>', 'review all cases in suite')
  .option('--url <url>', 'base URL of app under test')
  .option('--static-only', 'run static review via Anthropic API (no live UI)')
  .option('--prompt-only', 'just emit prompt for an external Claude agent')
  .option('--model <name>', 'override Anthropic model')
  .action(async (opts) => runAiReview(opts));

program
  .command('review-status')
  .description('Show pending/applied reviews')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .option('--suite <id>', 'filter by suite')
  .option('--format <type>', 'table|json', 'table')
  .action(async (opts) => runReviewStatus(opts));

program
  .command('review-apply')
  .description('Apply review suggestions to markdown')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .option('--id <id>', 'test case ID(s), comma-separated')
  .option('--suite <id>', 'all cases in suite')
  .option('--accept-all', 'accept every pending suggestion')
  .option('--reject-all', 'reject every pending suggestion')
  .option('--accept-above <n>', 'accept suggestions with confidence >= N')
  .action(async (opts) => runReviewApply(opts));

program
  .command('sync-back')
  .description('Push local markdown edits back to Azure DevOps')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .option('--id <id>', 'test case ID(s), comma-separated')
  .option('--suite <id>', 'all cases in suite')
  .option('--dry-run', 'report changes without pushing (default)')
  .option('--execute', 'actually push to ADO')
  .action(async (opts) => runSyncBack(opts));

program
  .command('agent-docs')
  .description('Generate copilot-instructions.md for AI coding agents')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .option('--output <path>', 'output file', '.github/copilot-instructions.md')
  .action(async (opts) => runAgentDocs(opts));

program
  .command('mcp-server')
  .description('Start MCP stdio server with test case tools')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .action(async (opts) => runMcpServer(opts));

program
  .command('quality')
  .description('Score test case quality (heuristic + flags)')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .option('--threshold <n>', 'only show cases scoring below N', '100')
  .option('--suite <id>', 'filter by suite')
  .option('--format <type>', 'table|json', 'table')
  .action(async (opts) => runQuality(opts));

program
  .command('dedupe')
  .description('Find similar/duplicate test cases')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .option('--threshold <n>', 'jaccard similarity threshold 0..1', '0.7')
  .option('--format <type>', 'table|json', 'table')
  .action(async (opts) => runDedupe(opts));

program
  .command('version-log')
  .description('Show git history of test case directory')
  .option('--config <path>', 'config path', '.testcasesync.json')
  .option('--limit <n>', 'max entries', '20')
  .action(async (opts) => runVersionLog(opts));

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(`\n✗ ${explainError(err)}`));
  if (process.env.LOG_LEVEL === 'debug') {
    logger.error({ err }, 'Fatal');
  }
  process.exit(1);
});
