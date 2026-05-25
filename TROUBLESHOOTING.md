# Troubleshooting

## Common Issues

### `AZURE_DEVOPS_PAT environment variable is required`

- `.env` is missing or empty. Run `cp .env.example .env` and add your PAT.

### `API request failed: 401 Unauthorized`

- PAT is incorrect or expired.
- Check scopes: **Test Management (Read)** and **Work Items (Read)**.
- For `sync-back` you also need **Work Items (Read & Write)**.

### `API request failed: 403 Forbidden`

- PAT does not have access to this project. Make sure the organization in config matches.

### `API request failed: 404 Not Found`

- Incorrect project or organization name (case-sensitive).
- Open the project in a browser and compare the URL.

### `API request failed: 429 Too Many Requests`

- Too many concurrent requests. Reduce `concurrency` in config (e.g., to 3).
- The client automatically retries with exponential backoff and respects `Retry-After`.

### `Unsupported sync state version`

- `.sync-state.json` is from an old version. Delete the file and run `sync --full`.

## Sync-back

### `CONFLICT — remote rev N ≠ local rev M`

Someone updated the test case in Azure DevOps after your last sync.
1. `npx tsx src/index.ts sync --plan X --suite Y` — pull the latest.
2. Re-check your local changes (or apply a review).
3. Retry `sync-back`.

### Fields not updating

- Steps are encoded in XML and compared after whitespace normalization. If the only difference is whitespace, the patch is not sent (intentional).
- Tags are separated by `;`, not `,`. If editing manually — watch the format.

## AI Review

### `ANTHROPIC_API_KEY required for --static-only`

Add the key to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

### Claude returned non-JSON

The parser is tolerant — it strips code fences and takes the first `{…}`. If it still fails,
check the raw output: `LOG_LEVEL=debug npx tsx src/index.ts ai-review --id X --static-only`.

### Suggestions were added but markdown didn't change

`review-apply` looks for the `before` string exactly. If Claude rephrased it slightly,
the suggestion is appended to the end of the file with a note `<!-- review: ... (could not locate before-text) -->`.
This is better than silently losing the suggestion.

## Git Versioning

### `Initializing git repo for test cases`

This is expected on the first run. A separate git repo is created in `test-cases/`.
Don't confuse it with the repo containing the tool itself.

### I want one shared repo

Set `git.enabled = false` in config — then there will be no initialization, and you commit
from the parent repo yourself.

## MCP Server

### Claude Desktop doesn't see the tools

- Full path to `tsx` and `src/index.ts` in `claude_desktop_config.json`.
- Check that `node` is in PATH (via `which node` / `where.exe node`).
- Logs: check `~/Library/Logs/Claude/mcp.log` (macOS) or `%APPDATA%\Claude\logs\` (Windows).

## Performance

### Sync is slow

- Increase `concurrency` (but not more than 10 — you'll hit 429).
- Enable `incrementalSync` (default is `true`).
- ETag caching saves bandwidth but not the number of requests — if ADO doesn't return 304, everything is fetched fresh.

### Attachments take up too much space

- Set `downloadAttachments: false`, or reduce `maxAttachmentSize`.
- Already downloaded files are not re-downloaded (if the file exists on disk).

## FAQ

**Q: Can I use the same PAT for multiple organizations?**
A: No — PAT is tied to one organization. Create separate configs for each and run them separately.

**Q: Where is `.review.json` stored?**
A: Next to the `.md` file — `TC-12345-foo.md` ↔ `TC-12345-foo.review.json`.

**Q: What if a test case is renamed in ADO?**
A: On the next `sync`, the file will be moved to the new location (slug changes) and the old one deleted. If git versioning is enabled, history is preserved (via `git log --follow`).

**Q: Is Test Plans v1 (legacy) supported?**
A: No, only Test Plans v2 (`/_apis/testplan/...`) is used. Legacy `/_apis/test/...` is not implemented.
