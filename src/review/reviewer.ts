import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';
import { logger } from '../core/logger.js';
import type { TestCase } from '../core/types.js';
import type { Config } from '../core/config-schema.js';
import { buildReviewPrompt } from './prompt-builder.js';
import type { ReviewArtifact, ReviewSuggestion } from './review-types.js';
import { scoreTestCaseHeuristic } from '../quality/quality-score.js';
import { contentHashOf } from '../core/markdown.js';

export interface RunReviewOpts {
  testCase: TestCase;
  /** Markdown file path so we can write the artifact next to it. */
  filePath: string;
  baseUrl?: string;
  apiKey: string;
  model?: string;
  config: Config;
  /**
   * If true, call Claude directly and let it write its analysis based on the
   * test case alone (no real Playwright execution). Useful for offline review.
   */
  staticAnalysisOnly?: boolean;
}

export interface PromptArtifact {
  promptPath: string;
  prompt: string;
}

/**
 * Two modes:
 *   1) `writePromptOnly`: write a `.review-prompt.md` that the user feeds into
 *      a Claude agent with Playwright MCP attached. The agent executes and
 *      writes back to `.review.json`. This is the "interactive" / `ai-review`
 *      flow described in start.md.
 *   2) `runStaticReview`: call the Anthropic API directly to get static
 *      analysis suggestions without execution. Faster, cheaper, lower fidelity.
 */
export class Reviewer {
  async writePromptOnly(opts: RunReviewOpts): Promise<PromptArtifact> {
    const quality = scoreTestCaseHeuristic(opts.testCase, opts.config);
    const prompt = buildReviewPrompt(opts.testCase, {
      baseUrl: opts.baseUrl ?? opts.config.review.defaultBaseUrl,
      qualityScore: quality,
    });
    const promptPath = opts.filePath.replace(/\.md$/, '.review-prompt.md');
    await mkdir(dirname(promptPath), { recursive: true });
    await writeFile(promptPath, prompt, 'utf8');
    logger.info({ promptPath, tcId: opts.testCase.id }, 'Wrote review prompt');
    return { promptPath, prompt };
  }

  async runStaticReview(opts: RunReviewOpts): Promise<ReviewArtifact> {
    const quality = scoreTestCaseHeuristic(opts.testCase, opts.config);
    const prompt = buildReviewPrompt(opts.testCase, {
      baseUrl: opts.baseUrl ?? opts.config.review.defaultBaseUrl,
      qualityScore: quality,
    });
    const client = new Anthropic({ apiKey: opts.apiKey });
    const model = opts.model ?? opts.config.review.model;

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system:
        'You are a senior QA engineer reviewing a test case statically (no live execution). ' +
        'Focus on test case structure, clarity, completeness, and likely automation pain points. ' +
        'Reply with valid JSON only.',
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((c) => c.type === 'text') as
      | { type: 'text'; text: string }
      | undefined;
    if (!textBlock) {
      throw new Error('Claude returned no text content');
    }
    const parsed = parseReviewJson(textBlock.text);

    const artifact: ReviewArtifact = {
      version: 1,
      testCaseId: opts.testCase.id,
      testCaseRev: opts.testCase.rev,
      testCaseHash: contentHashOf(opts.testCase, {
        inlineSharedSteps: opts.config.inlineSharedSteps,
      }),
      reviewedAt: new Date().toISOString(),
      reviewer: 'claude',
      model,
      baseUrl: opts.baseUrl ?? opts.config.review.defaultBaseUrl,
      outcome: parsed.outcome,
      suggestions: parsed.suggestions.map(
        (s, i): ReviewSuggestion => ({
          id: s.id ?? `s${i + 1}`,
          kind: s.kind,
          confidence: clampConfidence(s.confidence),
          targetStepId: s.targetStepId,
          before: s.before,
          after: s.after,
          rationale: s.rationale,
          evidence: s.evidence,
        }),
      ),
      decisions: {},
    };
    for (const s of artifact.suggestions) {
      artifact.decisions![s.id] = 'pending';
    }
    return artifact;
  }
}

interface ParsedReview {
  outcome: ReviewArtifact['outcome'];
  rationale?: string;
  suggestions: Array<Partial<ReviewSuggestion> & { kind: ReviewSuggestion['kind']; after: string; rationale: string }>;
}

function parseReviewJson(text: string): ParsedReview {
  // Tolerate fenced code blocks.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  // Find first { and last } to ignore stray prose.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in Claude response');
  const json = cleaned.slice(start, end + 1);
  const parsed = JSON.parse(json) as ParsedReview;
  if (!parsed.outcome) parsed.outcome = 'inconclusive';
  if (!Array.isArray(parsed.suggestions)) parsed.suggestions = [];
  return parsed;
}

function clampConfidence(n: unknown): 1 | 2 | 3 | 4 | 5 {
  const v = Math.max(1, Math.min(5, Math.round(Number(n) || 3)));
  return v as 1 | 2 | 3 | 4 | 5;
}

export function reviewFilePath(markdownPath: string): string {
  return markdownPath.replace(/\.md$/, '.review.json');
}

export async function saveReview(artifact: ReviewArtifact, markdownPath: string): Promise<string> {
  const path = reviewFilePath(markdownPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(artifact, null, 2), 'utf8');
  return path;
}

export async function loadReview(markdownPath: string): Promise<ReviewArtifact | null> {
  const path = reviewFilePath(markdownPath);
  if (!existsSync(path)) return null;
  const text = await readFile(path, 'utf8');
  return JSON.parse(text) as ReviewArtifact;
}

export interface MarkdownTestCase {
  data: Record<string, unknown>;
  content: string;
  path: string;
}

export async function loadMarkdownTestCase(path: string): Promise<MarkdownTestCase> {
  const text = await readFile(path, 'utf8');
  const parsed = matter(text);
  return { data: parsed.data, content: parsed.content, path };
}

export async function findTestCaseMarkdownById(
  outputDir: string,
  id: number,
): Promise<string | null> {
  if (!existsSync(outputDir)) return null;
  const entries = await readdir(outputDir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(`TC-${id}-`) || !entry.name.endsWith('.md')) continue;
    // Node 20+: `parentPath`. Older: `path`.
    const parent = (entry as { parentPath?: string; path?: string }).parentPath ??
      (entry as { parentPath?: string; path?: string }).path ?? outputDir;
    return join(parent, entry.name);
  }
  return null;
}
