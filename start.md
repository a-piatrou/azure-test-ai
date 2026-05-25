# Azure Test Sync

CLI tool for syncing manual test cases from Azure DevOps Test Plans to Markdown files.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create config (if not already present)
npx tsx src/index.ts init

# 3. Create secrets file
cp .env.example .env
# Edit .env — add your PAT token

# 4. Edit .testcasesync.json — specify organization and projects

# 5. Run sync
npx tsx src/index.ts sync
```

---

## Configuration

The tool uses **two configuration files** with clear roles:

### `.env` — secrets only

```env
AZURE_DEVOPS_PAT=your-token-here
```

This file:
- Contains ONLY the secret PAT token
- Is NOT committed to git (in `.gitignore`)
- Created manually: `cp .env.example .env`

### `.testcasesync.json` — sync settings

```json
{
  "organization": "orgname",
  "projects": [
    {
      "name": "MyProject",
      "planIds": [42, 55],
      "areaPath": "MyProject\\Module",
      "tags": ["smoke"]
    }
  ],
  "outputDir": "./test-cases",
  "downloadAttachments": true,
  "maxAttachmentSize": 10485760,
  "incrementalSync": true,
  "concurrency": 5
}
```

This file:
- Contains all NON-secret settings
- CAN be committed to git (team-wide settings)
- Created via `npx tsx src/index.ts init`

---

## Configuration Parameters

### `AZURE_DEVOPS_PAT` (required, in `.env`)

**What it is:** Personal Access Token — key for Azure DevOps API access.

**How to get:**
1. Open https://dev.azure.com/{your-organization}
2. Click your profile icon → **Personal Access Tokens**
3. Click **+ New Token**
4. Settings:
   - **Name:** `test-sync` (any name)
   - **Organization:** select your organization
   - **Expiration:** choose duration (max 1 year)
   - **Scopes** → Custom defined:
     - ✅ **Test Management** → Read
     - ✅ **Work Items** → Read
5. Click **Create** → copy token (shown only once!)

### `organization` (required, in `.testcasesync.json`)

**What it is:** Name of your organization in Azure DevOps.

**How to find:** Check the URL when you log into Azure DevOps:
```
https://dev.azure.com/orgname/...
                     ^^^^^^^^^^^^^^^^
                     this is organization
```

### `projects[].name` (required)

**What it is:** Name of the project in Azure DevOps.

**How to find:** This is the part of the URL after the organization:
```
https://dev.azure.com/orgname/MyProject/...
                                        ^^^^^^^^^
                                        this is project name
```

Or: Azure DevOps → left panel → project name.

### `projects[].planIds` (optional)

**What it is:** IDs of specific test plans to sync.

**How to find:**
1. Azure DevOps → Test Plans → select a plan
2. ID visible in URL: `.../_testPlans/define?planId=42` → ID = `42`

**If left empty `[]`:** ALL active test plans in the project are synced.

### `projects[].suiteIds` (optional)

**What it is:** IDs of specific test suites to sync within a plan.

**How to find:**
1. Azure DevOps → Test Plans → select plan → select suite
2. ID visible in URL: `.../_testPlans/define?planId=42&suiteId=100` → ID = `100`

**If not specified:** ALL suites within selected plans are synced.

**Example:**
```json
{
  "name": "",
  "planIds": [],
  "suiteIds": []
}
```
This syncs only the "FCA - Critical Path" suite (ID 16980) from the Squad 5 plan (ID 14119).

### `projects[].areaPath` (optional)

**What it is:** Filter by Area Path — syncs only test cases from a specific area.

**How to find:** Azure DevOps → Project Settings → Boards → Areas.

**Format:** `"Project\\Team\\Module"` (double backslash in JSON).

**If left empty `""`:** all area paths are synced.

### `projects[].tags` (optional)

**What it is:** Filter by test case tags.

**If left empty `[]`:** no tag filtering is applied.

### `outputDir`

**What it is:** Folder to save markdown files to.

**Default:** `"./test-cases"`

### `downloadAttachments`

**What it is:** Whether to download attachments (screenshots, files) from test cases.

**Default:** `true`

### `maxAttachmentSize`

**What it is:** Maximum size of a single attachment in bytes. Files larger are skipped.

**Default:** `10485760` (10 MB)

### `incrementalSync`

**What it is:** Incremental sync — download only changed test cases.

**Default:** `true`

### `concurrency`

**What it is:** Number of concurrent API requests. Higher = faster, but may hit rate limit.

**Default:** `5` (recommended)

### `apiVersion`

**What it is:** Version of Azure DevOps REST API.

**Default:** `"7.1"`

### `inlineSharedSteps`

**What it is:** Expand shared steps in test cases (substitute steps instead of links).

**Default:** `true`

### `pruneDeleted`

**What it is:** Delete local `.md` files for test cases deleted from Azure DevOps.

**Default:** `false`

---

## CLI Commands

### `sync` — sync test cases

```bash
npx tsx src/index.ts sync [options]
```

| Option | Description |
|--------|-------------|
| `--full` | Full resync (ignore cache) |
| `--dry-run` | Show what will be synced, don't write files |
| `--skip-validation` | Skip PAT/connection check |
| `--plan <ids>` | Override plan IDs (comma-separated), don't change config |
| `--suite <ids>` | Override suite IDs (comma-separated), don't change config |
| `--format <type>` | Output format: `text` (default) or `json` |
| `--config <path>` | Path to config file (default `.testcasesync.json`) |
| `--verbose` | Verbose output (debug) |

**Examples:**
```bash
# Normal sync (incremental)
npx tsx src/index.ts sync

# See what changed, don't touch files
npx tsx src/index.ts sync --dry-run

# Full resync from scratch
npx tsx src/index.ts sync --full

# Sync only specific plan and suite
npx tsx src/index.ts sync --plan 14119 --suite 16980 --dry-run

# JSON output for CI
npx tsx src/index.ts sync --dry-run --format json

# With verbose request output
npx tsx src/index.ts sync --verbose
```

### `validate` — check config and connection

```bash
npx tsx src/index.ts validate [options]
```

| Option | Description |
|--------|-------------|
| `--config <path>` | Path to config file (default `.testcasesync.json`) |
| `--verbose` | Verbose output (debug) |

Checks: config file, PAT token, API connection, project and plan availability.

### `list` — show synced test cases

```bash
npx tsx src/index.ts list [options]
```

| Option | Description |
|--------|-------------|
| `--priority <n>` | Filter by max priority (1=highest) |
| `--suite <id>` | Filter by suite ID |
| `--tags <tags>` | Filter by tags (comma-separated) |
| `--format <type>` | Format: `table` (default), `json`, `ids` |

**Examples:**
```bash
# Show all test cases as table
npx tsx src/index.ts list

# Only IDs for specific suite (for piping to test runner)
npx tsx src/index.ts list --suite 16801 --format ids

# Only high-priority in JSON
npx tsx src/index.ts list --priority 1 --format json
```

### `generate` — generate test scaffolds

```bash
npx tsx src/index.ts generate [options]
```

| Option | Description |
|--------|-------------|
| `--ids <ids>` | Test case IDs (comma-separated) |
| `--suite <id>` | Generate for all cases in suite |
| `--framework <name>` | Framework: `playwright` (default) or `cypress` |
| `--output <dir>` | Output directory (default `./tests/generated`) |

Generates `.spec.ts` skeletons with `test.step()` from test case steps. Does NOT generate working code — only TODO templates.

### `gaps` — show automation gaps

```bash
npx tsx src/index.ts gaps --tests-dir <path> [options]
```

| Option | Description |
|--------|-------------|
| `--tests-dir <path>` | Directory with automated tests (required) |
| `--format <type>` | Format: `table` (default) or `json` |

Compares test cases from `test-cases/` with files in test directory by `TC-{id}` naming convention.

### `context` — output test cases for AI agent

```bash
npx tsx src/index.ts context [options]
```

| Option | Description |
|--------|-------------|
| `--suite <id>` | Filter by suite ID |
| `--plan <id>` | Filter by plan ID |
| `--format <type>` | Format: `md` (default) or `json` |

Optimized output for feeding to LLM as context: titles, steps, expected results only.

### `init` — create config file

```bash
npx tsx src/index.ts init [options]
```

| Option | Description |
|--------|-------------|
| `--output <path>` | Path for config file (default `.testcasesync.json`) |

### `status` — show sync state

```bash
npx tsx src/index.ts status
```

Shows: last sync time, number of cases, plans, shared steps.

### `ai-review` — generate prompt for AI review

```bash
npx tsx src/index.ts ai-review [options]
```

| Option | Description |
|--------|-------------|
| `--id <id>` | Test case ID to review |
| `--suite <id>` | Review all cases in suite (by priority) |
| `--url <url>` | Base URL of app to test |

Generates a prompt for Claude agent to execute the test case on real UI through Playwright MCP and suggest improvements.

### `review-status` — show pending reviews

```bash
npx tsx src/index.ts review-status [options]
```

| Option | Description |
|--------|-------------|
| `--suite <id>` | Filter by suite ID |

Shows table of `.review.json` files with suggestion counts and average confidence.

### `review-apply` — apply review suggestions

```bash
npx tsx src/index.ts review-apply [options]
```

| Option | Description |
|--------|-------------|
| `--id <id>` | Apply for specific test case |
| `--suite <id>` | Apply for all cases in suite |
| `--accept-all` | Accept all suggestions |
| `--reject-all` | Reject all suggestions |
| `--accept-above <n>` | Accept suggestions with confidence above N (1-5) |

### `sync-back` — sync changes back to Azure DevOps

```bash
npx tsx src/index.ts sync-back [options]
```

| Option | Description |
|--------|-------------|
| `--id <id>` | Test case ID to sync |
| `--suite <id>` | Sync all cases in suite |
| `--dry-run` | Show what will change (default) |
| `--execute` | Execute changes (without this flag — dry-run only) |

**Important:** Works in dry-run mode by default. Pass `--execute` for actual updates.

### `agent-docs` — generate AI agent documentation

```bash
npx tsx src/index.ts agent-docs [options]
```

Generates `copilot-instructions.md` with available test cases for AI agents.

### `mcp-server` — run MCP server

```bash
npx tsx src/index.ts mcp-server
```

Runs Model Context Protocol server (stdio transport) with 10 tools for AI agents:
- `list_test_cases` — search with filters
- `get_test_case` — get single case
- `search_test_cases` — full-text search
- `get_suite_context` — suite overview
- `refresh_cache` — refresh cache
- `start_review` / `report_step_result` / `suggest_improvement` / `complete_review` / `get_review_status` — review workflow

---

## Output File Structure

After sync, the following structure is created:

```
test-cases/
├── .sync-state.json                    # Sync cache (don't edit)
├── MyProject/
│   ├── plan-42-sprint-42/
│   │   ├── _plan.md                    # Test plan description
│   │   ├── suite-10-login-tests/
│   │   │   ├── _suite.md              # Test cases index in suite
│   │   │   ├── TC-12345-verify-login.md
│   │   │   ├── TC-12346-verify-logout.md
│   │   │   └── attachments/
│   │   │       └── TC-12345/
│   │   │           └── screenshot.png
│   │   └── suite-11-registration/
│   │       ├── _suite.md
│   │       └── TC-12400-register-user.md
│   └── shared-steps/
│       └── SS-300-standard-login.md
└── AnotherProject/
    └── ...
```

---

## Multiple Projects/Applications

To sync test plans from different projects — add them to the `projects` array:

```json
{
  "organization": "",
  "projects": [
    {
      "name": "",
      "planIds": [10, 20]
    },
    {
      "name": "",
      "planIds": []
    },
    {
      "name": "",
      "areaPath": "appname\\Backend"
    }
  ]
}
```

Each project creates its own subfolder in `outputDir`.

---

## Troubleshooting

### `AZURE_DEVOPS_PAT environment variable is required`

You didn't create `.env` or it doesn't contain a token.

```bash
cp .env.example .env
# Edit .env and add your real PAT
```

### `API request failed: 401 Unauthorized`

PAT is incorrect, expired, or lacks required scopes. Check:
- Token copied without spaces
- Token not expired (check Azure DevOps → Personal Access Tokens)
- Token has scopes: `Test Management (Read)` + `Work Items (Read)`

### `API request failed: 403 Forbidden`

PAT doesn't have access to the project. Make sure organization matches.

### `API request failed: 404 Not Found`

Wrong project or organization name. Check URL in browser.

### `API request failed: 429 Too Many Requests`

Too many requests. Reduce `concurrency` in config (e.g., to `3`). Tool automatically retries, but reducing parallelism may help with large volumes.

---

## Development

```bash
# Run tests
npm test

# Type check
npx tsc --noEmit

# Run in dev mode
npx tsx src/index.ts sync --verbose
```
 