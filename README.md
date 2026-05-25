# azure-test-sync

Bidirectional sync between Azure DevOps Test Plans and markdown files, with AI review via Claude + Playwright, quality scoring, deduplication, and git versioning.

> Idea: test cases are stored in the repository as markdown (readable, diff-able, review via PR). Azure DevOps remains the system of record, but all work happens in code. Claude can review test cases by executing them on a live UI through Playwright MCP.

## Features

| | Command | What it does |
|---|---|---|
| **Sync** | `sync` | ADO → markdown, incrementally, with attachments and shared steps |
| | `sync-back` | markdown → ADO, with conflict detection |
| | `validate` | Check config and API access |
| **Queries** | `list` | Table of all test cases with filters by priority/suite/tags |
| | `status` | Last sync state |
| | `context` | Compact output for feeding to LLM |
| | `version-log` | git history of test cases |
| **AI** | `ai-review` | Generate review-prompt or run static review |
| | `review-status` | Overview of pending/applied reviews |
| | `review-apply` | Apply suggestions filtered by confidence |
| | `mcp-server` | MCP server with 10 tools for AI agents |
| **Quality** | `quality` | Quality scoring with ambiguity detection |
| | `dedupe` | Find similar/duplicate test cases |
| | `gaps` | Test cases without automated tests |
| **Scaffold** | `generate` | `.spec.ts` templates for Playwright/Cypress |
| | `agent-docs` | `copilot-instructions.md` for AI agents |
| | `init` | Create `.testcasesync.json` |

## Quick Start

```bash
npm install
cp .env.example .env          # then add your PAT
npx tsx src/index.ts init     # creates .testcasesync.json
# edit .testcasesync.json — specify organization and projects
npx tsx src/index.ts validate # check access
npx tsx src/index.ts sync     # first sync
```

## Configuration

Two files:

- **`.env`** — only `AZURE_DEVOPS_PAT` (and optionally `ANTHROPIC_API_KEY` for AI review).
- **`.testcasesync.json`** — all settings. Detailed field descriptions — see `start.md`.

Additional (on top of `start.md`):

```jsonc
{
  "git": {
    "enabled": true,           // enable automatic git commit after sync
    "autoCommit": true
  },
  "review": {
    "model": "claude-opus-4-7",
    "defaultBaseUrl": "https://staging.example.com",
    "autoApplyAboveConfidence": 5,
    "capturePlaywrightTrace": true
  },
  "quality": {
    "minStepCount": 2,
    "minDescriptionLength": 20,
    "useLlm": false
  }
}
```

## Workflow: Review test case through Claude

```bash
# 1. Generate prompt for a single test case
npx tsx src/index.ts ai-review --id 12345 --url https://staging.example.com --prompt-only

# 2. In Claude Code (or claude.ai) with Playwright MCP — paste the prompt from
#    test-cases/.../TC-12345-....review-prompt.md. Claude will execute the steps
#    through Playwright and write the result to TC-12345-....review.json.

# 3. Review results
npx tsx src/index.ts review-status

# 4. Accept suggestions with confidence ≥ 4 (or --accept-all)
npx tsx src/index.ts review-apply --id 12345 --accept-above 4

# 5. Push back to ADO (dry-run first)
npx tsx src/index.ts sync-back --id 12345
npx tsx src/index.ts sync-back --id 12345 --execute
```

Alternative — static review without live UI:

```bash
ANTHROPIC_API_KEY=sk-... npx tsx src/index.ts ai-review --id 12345 --static-only
```

## Versioning

When `git.enabled = true`, each `sync` makes a commit in the `test-cases/` directory. History for a single test case:

```bash
git -C test-cases log --follow -- '**/TC-12345-*.md'
git -C test-cases diff HEAD~5 -- '**/TC-12345-*.md'
npx tsx src/index.ts version-log --limit 50
```

## Sync-back and Conflict Detection

`sync-back` uses optimistic concurrency:
1. From frontmatter, get the `rev` under which the test case was synced.
2. Compare the current remote rev with the local one.
3. If remote has moved ahead — push is blocked (conflict).
4. If they match — send PATCH with `If-Match: W/"rev"`.

To resolve a conflict: `sync` → manually merge changes in markdown → retry `sync-back`.

## MCP Server

```bash
npx tsx src/index.ts mcp-server
```

10 tools for AI agents (stdio transport):
`list_test_cases`, `get_test_case`, `search_test_cases`, `get_suite_context`,
`refresh_cache`, `start_review`, `report_step_result`, `suggest_improvement`,
`complete_review`, `get_review_status`.

Configure in Claude Desktop:

```jsonc
{
  "mcpServers": {
    "azure-test-sync": {
      "command": "npx",
      "args": ["tsx", "C:/path/to/azure-test-sync/src/index.ts", "mcp-server"]
    }
  }
}
```

## CI

In `.github/workflows/`:
- `sync.yml` — daily `sync` with PR from changes
- `quality.yml` — quality gate on PRs to `test-cases/**`
- `test.yml` — unit tests and typecheck

Also included: `azure-pipelines.yml`.

## Beyond `start.md`

| Enhancement | Location |
|---|---|
| Git versioning (auto-commit) | `src/version/git-versioning.ts` |
| Conflict detection in sync-back | `src/sync/sync-back.ts` |
| Quality scoring (heuristic) | `src/quality/quality-score.ts` |
| Semantic dedupe (MinHash-like) | `src/quality/dedupe.ts` |
| ETag/If-None-Match caching | `src/core/ado-client.ts` |
| Structured logging (pino) | `src/core/logger.ts` |
| Zod config validation | `src/core/config-schema.ts` |
| 14 CLI commands + 3 additional (`quality`, `dedupe`, `version-log`) | `src/cli/commands/` |
| CI templates (GitHub Actions + Azure Pipelines) | `.github/workflows/` |

## Future Ideas (Not Implemented)

- **Embeddings-based dedupe** via Voyage/Cohere for better semantics
- **Webhook receiver** for push updates from ADO (instead of polling)
- **Flaky test detection** — track pass/fail history in `.review.json`
- **Test dependency graph** — static analysis of cross-test dependencies
- **TUI dashboard** for interactive review
- **Slack/Teams notifications** on changes after sync
- **Test plan auto-rotation** — move test cases to "Inactive" plan if unchanged for long
- **Self-healing tests** — Claude suggests auto-test fixes based on CI failures
- **Coverage mapping** — link test case ↔ code path via tags
- **Snapshot tests for rendering** — protection against markdown formatting regressions

## Development

```bash
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run lint      # eslint (if installed)
```

## License

MIT
