import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { loadConfig } from '../../core/config.js';

export interface AgentDocsOpts {
  config?: string;
  output?: string;
}

/**
 * Emit a markdown file that AI coding agents (Copilot, Cursor, Claude Code) can
 * include in their context. It documents what tools exist, the on-disk layout,
 * and the recommended workflow.
 */
export async function runAgentDocs(opts: AgentDocsOpts): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const out = opts.output ?? '.github/copilot-instructions.md';
  const target = resolve(out);

  const content = `# Test Case Sync — agent instructions

This repository syncs Azure DevOps test cases to markdown at \`${loaded.config.outputDir}/\`.

## Layout

\`\`\`
${loaded.config.outputDir}/
  <project>/
    plan-<id>-<slug>/
      _plan.md
      suite-<id>-<slug>/
        _suite.md
        TC-<id>-<slug>.md          # one test case per file
        TC-<id>-<slug>.review.json  # AI review artifacts (if any)
        attachments/TC-<id>/...
    shared-steps/
      SS-<id>-<slug>.md
\`\`\`

## How to find test cases

- By id: search for \`TC-<id>-\` filenames.
- By suite: read \`_suite.md\` for an indexed list.
- Frontmatter at the top of each TC has \`id\`, \`rev\`, \`title\`, \`priority\`, \`tags\`, \`suiteIds\`, \`planIds\`.

## How to update a test case

1. Edit the markdown file directly (preserve the frontmatter).
2. Run \`npx tsx src/index.ts sync-back --id <id>\` to dry-run.
3. Run with \`--execute\` to push back to Azure DevOps.

Sync-back uses optimistic concurrency: if the remote rev moved past your local rev, the push aborts.
Re-run \`sync\` first to merge, then re-apply.

## Useful CLI commands

| Goal | Command |
|------|---------|
| List all test cases | \`npx tsx src/index.ts list\` |
| Find high-priority cases | \`npx tsx src/index.ts list --priority 1\` |
| Get cases in suite N | \`npx tsx src/index.ts list --suite N --format ids\` |
| Compact context for LLM | \`npx tsx src/index.ts context --suite N\` |
| Find duplicates | \`npx tsx src/index.ts dedupe\` |
| Quality scores | \`npx tsx src/index.ts quality\` |
| Status of pending reviews | \`npx tsx src/index.ts review-status\` |

## MCP server

\`\`\`bash
npx tsx src/index.ts mcp-server
\`\`\`

Exposes 10 stdio MCP tools (\`list_test_cases\`, \`get_test_case\`, \`search_test_cases\`, \`get_suite_context\`, \`refresh_cache\`, \`start_review\`, \`report_step_result\`, \`suggest_improvement\`, \`complete_review\`, \`get_review_status\`).

## Versioning

When \`git.enabled = true\` in \`.testcasesync.json\`, each sync auto-commits the markdown directory. You can diff a single test case across syncs:

\`\`\`bash
git -C ${loaded.config.outputDir} log -- '**/TC-<id>-*.md'
\`\`\`
`;

  await writeFile(target, content, 'utf8');
  console.log(chalk.green(`✓ Wrote ${target}`));
}
