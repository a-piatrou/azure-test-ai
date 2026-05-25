# Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          CLI                                     │
│  init │ validate │ sync │ list │ status │ generate │ gaps │      │
│  context │ ai-review │ review-status │ review-apply │ sync-back │
│  agent-docs │ mcp-server │ quality │ dedupe │ version-log       │
└────────┬────────────────────────────────────────────────────────┘
         │
         ├─→ core            (config, API client, markdown rendering, sync state)
         ├─→ sync            (sync engine, sync-back with conflict detection)
         ├─→ review          (AI review prompts, suggestion application)
         ├─→ quality         (quality scoring, deduplication)
         ├─→ version         (git integration)
         └─→ mcp             (Model Context Protocol server)
```

## Sync Flow (ADO → markdown)

1. Loads sync state and iterates projects from config.
2. For each project:
   - Fetches test plans (filtered by `planIds` if specified).
   - Gets test suites (filtered by `suiteIds` if specified).
   - Collects all test case IDs from suites.
   - Filters by `areaPath` and `tags`.
   - Collects shared steps.
   - Renders and writes markdown files with test case content.
   - Downloads attachments if enabled and within size limits.
   - Updates sync state (tracks revisions and hashes).
3. Saves sync state for incremental syncs.
4. If `git.enabled`, creates automatic commit with changes.

## Sync-back Flow (markdown → ADO)

1. Reads test case ID and revision from markdown frontmatter.
2. Checks the current revision in Azure DevOps.
3. Detects conflicts if the remote version has changed since last sync.
4. Parses markdown content: title, description, preconditions, steps.
5. Sends changes back to Azure DevOps with conflict prevention.
6. On success, updates the local sync metadata.

## AI Review Flow

```
┌──────────┐        ┌──────────────┐         ┌──────────────────┐
│  ats     │  →     │ TC-N.review- │  ◇   →  │  Claude Code +   │
│ ai-review│        │ prompt.md    │  ◇      │  Playwright MCP  │
└──────────┘        └──────────────┘  ◇      └────────┬─────────┘
                                                       │
                                                       ▼
                                        ┌──────────────────────────┐
                                        │  TC-N.review.json         │
                                        │  {outcome, suggestions}   │
                                        └─────────┬────────────────┘
                                                  │
                            ┌─────────────────────┘
                            ▼
                    ┌──────────────┐        ┌──────────────┐
                    │ review-apply │  →     │ TC-N.md      │
                    │ (accept N+)  │        │ (updated)    │
                    └──────────────┘        └──────┬───────┘
                                                   │
                                                   ▼
                                            ┌──────────────┐
                                            │  sync-back   │
                                            │  --execute   │
                                            └──────────────┘
```

## Quality Scoring

Analyzes test cases for quality issues:
- Checks for missing or incomplete sections (steps, tags, description, preconditions)
- Detects ambiguous language patterns
- Identifies common quality issues

Results in a quality score to help prioritize test case improvements.

Optional LLM mode (future): can use Claude to perform deeper semantic analysis.

## Deduplication

Finds similar or duplicate test cases by analyzing test case content (title, description, steps).

Uses a fast, offline similarity detection approach. Results include a similarity score to help identify and merge duplicate test cases.

Can be extended with semantic analysis via external embeddings services if needed.

## Directory Structure

```
test-cases/
├── .git/                          # auto-init if git.enabled
├── .sync-state.json
├── <project-slug>/
│   ├── plan-42-sprint/
│   │   ├── _plan.md
│   │   ├── suite-10-login/
│   │   │   ├── _suite.md
│   │   │   ├── TC-555-verify-login.md
│   │   │   ├── TC-555-verify-login.review.json   (if review exists)
│   │   │   ├── TC-555-verify-login.review-prompt.md (if ai-review --prompt-only was run)
│   │   │   └── attachments/TC-555/screenshot.png
│   │   └── suite-11-signup/
│   │       └── ...
│   └── shared-steps/
│       └── SS-300-standard-login.md
└── <another-project>/...
```

## Extensibility

The tool is designed to be extended with new commands and custom behavior:

- **Adding commands:** Follow the CLI module pattern to add new commands
- **Custom processing:** The markdown rendering pipeline supports custom transformations
- **Plugin architecture:** Can be extended through configuration to support custom workflows

For implementation details, see the source code in `src/` directory.
