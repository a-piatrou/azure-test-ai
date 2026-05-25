import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { logger } from '../core/logger.js';
import { loadSyncState } from '../core/sync-state.js';
import { SyncEngine } from '../sync/sync-engine.js';
import { AdoClient } from '../core/ado-client.js';
import type { LoadedConfig } from '../core/config.js';
import { loadReview, saveReview, findTestCaseMarkdownById } from '../review/reviewer.js';
import type { ReviewArtifact, ReviewSuggestion } from '../review/review-types.js';

interface TestCaseSummary {
  id: number;
  title: string;
  priority: number;
  state: string;
  tags: string[];
  path: string;
  suiteIds: number[];
  planIds: number[];
  changedDate?: string;
}

export async function startMcpServer(loaded: LoadedConfig): Promise<void> {
  const server = new Server(
    { name: 'azure-test-sync', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  const outputDir = loaded.config.outputDir;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_test_cases',
        description:
          'List synced test cases with optional filters. Returns title, priority, state, tags, file path.',
        inputSchema: {
          type: 'object',
          properties: {
            priorityMax: { type: 'number', description: 'Filter: maximum priority (1=highest)' },
            suiteId: { type: 'number' },
            planId: { type: 'number' },
            tags: { type: 'array', items: { type: 'string' } },
            limit: { type: 'number', default: 100 },
          },
        },
      },
      {
        name: 'get_test_case',
        description: 'Fetch a single test case with full body by id.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'number' } },
          required: ['id'],
        },
      },
      {
        name: 'search_test_cases',
        description: 'Full-text search across titles, descriptions, steps, and tags.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number', default: 20 },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_suite_context',
        description:
          'Compact suite overview for LLMs: suite name, plan, test case titles + priorities.',
        inputSchema: {
          type: 'object',
          properties: { suiteId: { type: 'number' } },
          required: ['suiteId'],
        },
      },
      {
        name: 'refresh_cache',
        description: 'Trigger an incremental sync from Azure DevOps.',
        inputSchema: { type: 'object', properties: { full: { type: 'boolean', default: false } } },
      },
      {
        name: 'start_review',
        description:
          'Initialize a review session for a test case. Returns the prompt to execute.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'number' }, baseUrl: { type: 'string' } },
          required: ['id'],
        },
      },
      {
        name: 'report_step_result',
        description:
          'Record a step execution result during an ongoing review (for traceability).',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            stepNumber: { type: 'number' },
            outcome: { type: 'string', enum: ['pass', 'fail', 'inconclusive'] },
            evidence: { type: 'string' },
          },
          required: ['id', 'stepNumber', 'outcome'],
        },
      },
      {
        name: 'suggest_improvement',
        description: 'Append a suggestion to the review for a given test case.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            kind: { type: 'string' },
            confidence: { type: 'number' },
            after: { type: 'string' },
            before: { type: 'string' },
            rationale: { type: 'string' },
            targetStepId: { type: 'number' },
          },
          required: ['id', 'kind', 'after', 'rationale'],
        },
      },
      {
        name: 'complete_review',
        description: 'Finalize a review session with an overall outcome.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            outcome: { type: 'string', enum: ['pass', 'fail', 'partial', 'inconclusive'] },
          },
          required: ['id', 'outcome'],
        },
      },
      {
        name: 'get_review_status',
        description: 'Get review status for a test case (suggestions, decisions, applied state).',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'number' } },
          required: ['id'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      switch (name) {
        case 'list_test_cases': {
          const cases = await loadAllSummaries(outputDir);
          let filtered = cases;
          if (typeof args.priorityMax === 'number') {
            filtered = filtered.filter((c) => c.priority <= (args.priorityMax as number));
          }
          if (typeof args.suiteId === 'number') {
            filtered = filtered.filter((c) => c.suiteIds.includes(args.suiteId as number));
          }
          if (typeof args.planId === 'number') {
            filtered = filtered.filter((c) => c.planIds.includes(args.planId as number));
          }
          if (Array.isArray(args.tags) && args.tags.length) {
            const required = args.tags as string[];
            filtered = filtered.filter((c) => required.every((t) => c.tags.includes(t)));
          }
          const limit = (args.limit as number) ?? 100;
          return { content: [{ type: 'text', text: JSON.stringify(filtered.slice(0, limit), null, 2) }] };
        }
        case 'get_test_case': {
          const id = args.id as number;
          const path = await findTestCaseMarkdownById(outputDir, id);
          if (!path) {
            return { content: [{ type: 'text', text: `Test case ${id} not found in cache` }], isError: true };
          }
          const text = await readFile(path, 'utf8');
          return { content: [{ type: 'text', text }] };
        }
        case 'search_test_cases': {
          const q = ((args.query as string) ?? '').toLowerCase();
          const limit = (args.limit as number) ?? 20;
          const matches: Array<TestCaseSummary & { snippet: string }> = [];
          const files = await markdownFiles(outputDir);
          for (const file of files) {
            const text = await readFile(file, 'utf8');
            const lower = text.toLowerCase();
            if (!lower.includes(q)) continue;
            const idx = lower.indexOf(q);
            const snippet = text.slice(Math.max(0, idx - 60), idx + 120).replace(/\s+/g, ' ');
            const parsed = matter(text);
            matches.push({ ...frontmatterToSummary(parsed.data, file), snippet });
            if (matches.length >= limit) break;
          }
          return { content: [{ type: 'text', text: JSON.stringify(matches, null, 2) }] };
        }
        case 'get_suite_context': {
          const suiteId = args.suiteId as number;
          const cases = (await loadAllSummaries(outputDir)).filter((c) => c.suiteIds.includes(suiteId));
          const overview = {
            suiteId,
            count: cases.length,
            byPriority: groupBy(cases, (c) => `P${c.priority}`),
            cases: cases.map((c) => ({ id: c.id, title: c.title, priority: c.priority })),
          };
          return { content: [{ type: 'text', text: JSON.stringify(overview, null, 2) }] };
        }
        case 'refresh_cache': {
          const client = new AdoClient({
            organization: loaded.config.organization,
            pat: loaded.pat,
            apiVersion: loaded.config.apiVersion,
          });
          const engine = new SyncEngine(client, loaded.config);
          const result = await engine.run({ full: !!args.full });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    added: result.added.length,
                    updated: result.updated.length,
                    unchanged: result.unchanged.length,
                    deleted: result.deleted.length,
                    errors: result.errors.length,
                    durationMs: result.durationMs,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        case 'start_review': {
          const id = args.id as number;
          const path = await findTestCaseMarkdownById(outputDir, id);
          if (!path) return { content: [{ type: 'text', text: `not found: ${id}` }], isError: true };
          // Initialise an empty review file so subsequent suggest_improvement calls have somewhere to write
          let review = await loadReview(path);
          if (!review) {
            review = await makeEmptyReview(path, id);
            await saveReview(review, path);
          }
          return { content: [{ type: 'text', text: JSON.stringify(review, null, 2) }] };
        }
        case 'report_step_result': {
          const id = args.id as number;
          const path = await findTestCaseMarkdownById(outputDir, id);
          if (!path) return { content: [{ type: 'text', text: `not found: ${id}` }], isError: true };
          const review = (await loadReview(path)) ?? (await makeEmptyReview(path, id));
          // Encode per-step evidence as a low-confidence suggestion attached to the step,
          // so the review JSON remains a single source of truth.
          review.suggestions.push({
            id: `step-${args.stepNumber}-${Date.now()}`,
            kind: 'add-automation-note',
            confidence: 2,
            targetStepId: args.stepNumber as number,
            after: `[step ${args.stepNumber}] outcome=${args.outcome}: ${args.evidence ?? ''}`.trim(),
            rationale: 'Step execution result recorded during review',
          });
          await saveReview(review, path);
          return { content: [{ type: 'text', text: 'recorded' }] };
        }
        case 'suggest_improvement': {
          const id = args.id as number;
          const path = await findTestCaseMarkdownById(outputDir, id);
          if (!path) return { content: [{ type: 'text', text: `not found: ${id}` }], isError: true };
          const review = (await loadReview(path)) ?? (await makeEmptyReview(path, id));
          const suggestion: ReviewSuggestion = {
            id: `mcp-${Date.now()}-${review.suggestions.length}`,
            kind: args.kind as ReviewSuggestion['kind'],
            confidence: Math.max(1, Math.min(5, Number(args.confidence ?? 3))) as 1 | 2 | 3 | 4 | 5,
            after: args.after as string,
            before: args.before as string | undefined,
            rationale: args.rationale as string,
            targetStepId: args.targetStepId as number | undefined,
          };
          review.suggestions.push(suggestion);
          review.decisions ??= {};
          review.decisions[suggestion.id] = 'pending';
          await saveReview(review, path);
          return { content: [{ type: 'text', text: suggestion.id }] };
        }
        case 'complete_review': {
          const id = args.id as number;
          const path = await findTestCaseMarkdownById(outputDir, id);
          if (!path) return { content: [{ type: 'text', text: `not found: ${id}` }], isError: true };
          const review = (await loadReview(path)) ?? (await makeEmptyReview(path, id));
          review.outcome = args.outcome as ReviewArtifact['outcome'];
          review.reviewedAt = new Date().toISOString();
          await saveReview(review, path);
          return { content: [{ type: 'text', text: 'review-complete' }] };
        }
        case 'get_review_status': {
          const id = args.id as number;
          const path = await findTestCaseMarkdownById(outputDir, id);
          if (!path) return { content: [{ type: 'text', text: `not found: ${id}` }], isError: true };
          const review = await loadReview(path);
          return { content: [{ type: 'text', text: JSON.stringify(review ?? { suggestions: [] }, null, 2) }] };
        }
        default:
          return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
      }
    } catch (err) {
      logger.error({ err, name }, 'MCP tool error');
      return { content: [{ type: 'text', text: `error: ${(err as Error).message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server ready (stdio)');
}

async function loadAllSummaries(outputDir: string): Promise<TestCaseSummary[]> {
  const state = await loadSyncState(outputDir);
  const out: TestCaseSummary[] = [];
  if (state) {
    for (const project of Object.values(state.projects)) {
      for (const [idStr, entry] of Object.entries(project.testCases)) {
        const text = await readFile(join(outputDir, entry.path), 'utf8').catch(() => '');
        if (!text) continue;
        const parsed = matter(text);
        out.push(frontmatterToSummary(parsed.data, join(outputDir, entry.path)));
      }
    }
    return out;
  }
  // Fallback: scan filesystem if sync-state missing
  const files = await markdownFiles(outputDir);
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    const parsed = matter(text);
    if (parsed.data && typeof parsed.data.id === 'number') {
      out.push(frontmatterToSummary(parsed.data, f));
    }
  }
  return out;
}

async function markdownFiles(outputDir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(outputDir, { recursive: true, withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.startsWith('TC-') || !e.name.endsWith('.md')) continue;
    const parent = (e as { parentPath?: string; path?: string }).parentPath ??
      (e as { parentPath?: string; path?: string }).path ?? outputDir;
    out.push(join(parent, e.name));
  }
  return out;
}

function frontmatterToSummary(data: Record<string, unknown>, path: string): TestCaseSummary {
  return {
    id: Number(data.id),
    title: String(data.title ?? ''),
    priority: Number(data.priority ?? 3),
    state: String(data.state ?? ''),
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    path,
    suiteIds: Array.isArray(data.suiteIds) ? (data.suiteIds as number[]) : [],
    planIds: Array.isArray(data.planIds) ? (data.planIds as number[]) : [],
    changedDate: data.changedDate as string | undefined,
  };
}

function groupBy<T>(arr: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of arr) {
    const k = key(x);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

async function makeEmptyReview(path: string, id: number): Promise<ReviewArtifact> {
  const text = await readFile(path, 'utf8');
  const parsed = matter(text);
  return {
    version: 1,
    testCaseId: id,
    testCaseRev: Number(parsed.data.rev ?? 0),
    testCaseHash: 'mcp-session',
    reviewedAt: new Date().toISOString(),
    reviewer: 'claude',
    outcome: 'inconclusive',
    suggestions: [],
    decisions: {},
  };
}
