import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  AxiosError,
  AxiosHeaders,
} from 'axios';
import axiosRetry, { isNetworkError, isRetryableError } from 'axios-retry';
import { ApiError } from './errors.js';
import { logger } from './logger.js';
import type { TestPlan, TestSuite, TestCase, SharedStep, TestStep, AttachmentRef } from './types.js';

export interface AdoClientOptions {
  organization: string;
  pat: string;
  apiVersion?: string;
  timeoutMs?: number;
}

interface RawWorkItem {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
  relations?: Array<{ rel: string; url: string; attributes?: Record<string, unknown> }>;
  url: string;
}

interface RawWorkItemQueryResult {
  workItems: Array<{ id: number; url: string }>;
}

const ATTACHMENT_FIELD = 'AttachedFile';
const TEST_STEPS_FIELD = 'Microsoft.VSTS.TCM.Steps';
const SHARED_STEPS_FIELD = 'Microsoft.VSTS.TCM.Steps';

export class AdoClient {
  private readonly http: AxiosInstance;
  private readonly organization: string;
  private readonly apiVersion: string;
  private readonly etags = new Map<string, string>();

  constructor(opts: AdoClientOptions) {
    this.organization = opts.organization;
    this.apiVersion = opts.apiVersion ?? '7.1';
    const auth = Buffer.from(`:${opts.pat}`).toString('base64');
    this.http = axios.create({
      baseURL: `https://dev.azure.com/${encodeURIComponent(opts.organization)}`,
      timeout: opts.timeoutMs ?? 30_000,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
      validateStatus: (s) => s < 500 || s === 304,
    });

    axiosRetry(this.http, {
      retries: 4,
      retryDelay: (retryCount, error) => {
        const status = error.response?.status;
        if (status === 429) {
          const retryAfter = Number(error.response?.headers?.['retry-after']);
          if (Number.isFinite(retryAfter) && retryAfter > 0) {
            return Math.min(retryAfter * 1000, 30_000);
          }
        }
        return Math.min(2 ** retryCount * 500, 15_000);
      },
      retryCondition: (error) => {
        if (isNetworkError(error)) return true;
        const status = error.response?.status;
        if (status === 429) return true;
        if (status && status >= 500) return true;
        return isRetryableError(error);
      },
    });

    this.http.interceptors.request.use((config) => {
      config.params = { 'api-version': this.apiVersion, ...(config.params ?? {}) };
      const cacheKey = this.cacheKeyFor(config);
      const etag = cacheKey ? this.etags.get(cacheKey) : undefined;
      if (etag) {
        if (!config.headers) config.headers = new AxiosHeaders();
        (config.headers as AxiosHeaders).set('If-None-Match', etag);
      }
      logger.debug({ url: config.url, params: config.params }, 'ADO request');
      return config;
    });

    this.http.interceptors.response.use((resp) => {
      const cacheKey = this.cacheKeyFor(resp.config);
      const newEtag = resp.headers?.etag;
      if (cacheKey && typeof newEtag === 'string') this.etags.set(cacheKey, newEtag);
      return resp;
    });
  }

  private cacheKeyFor(config: AxiosRequestConfig): string | undefined {
    if (!config.url || config.method?.toLowerCase() !== 'get') return undefined;
    const params = config.params ? JSON.stringify(config.params) : '';
    return `${config.url}?${params}`;
  }

  private async req<T>(config: AxiosRequestConfig): Promise<T> {
    try {
      const resp = await this.http.request<T>(config);
      if (resp.status === 304) {
        throw new ApiError(304, resp.config.url ?? '?', 'Not modified', { body: undefined });
      }
      if (resp.status >= 400) {
        throw new ApiError(
          resp.status,
          resp.config.url ?? '?',
          this.formatErrorMessage(resp.status, resp.data),
          { body: resp.data, hint: this.hintForStatus(resp.status) },
        );
      }
      return resp.data;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof AxiosError) {
        const status = err.response?.status ?? 0;
        throw new ApiError(
          status,
          err.config?.url ?? '?',
          err.message,
          { body: err.response?.data, hint: this.hintForStatus(status), cause: err },
        );
      }
      throw err;
    }
  }

  private formatErrorMessage(status: number, body: unknown): string {
    if (body && typeof body === 'object' && 'message' in body) {
      return `API ${status}: ${(body as { message: string }).message}`;
    }
    return `API request failed: ${status}`;
  }

  private hintForStatus(status: number): string | undefined {
    switch (status) {
      case 401:
        return 'PAT invalid or expired. Check token in https://dev.azure.com/{org}/_usersSettings/tokens';
      case 403:
        return 'PAT lacks required scopes. Need: Test Management (Read), Work Items (Read)';
      case 404:
        return 'Check organization and project names in .testcasesync.json';
      case 429:
        return 'Rate limited. Reduce `concurrency` in config or wait';
      default:
        return undefined;
    }
  }

  async ping(): Promise<{ user: string }> {
    const data = await this.req<{ authenticatedUser: { providerDisplayName: string } }>(
      { url: '/_apis/connectionData', method: 'GET' },
    );
    return { user: data.authenticatedUser?.providerDisplayName ?? 'unknown' };
  }

  async listPlans(project: string): Promise<TestPlan[]> {
    const data = await this.req<{ value: Array<Record<string, unknown>> }>({
      url: `/${encodeURIComponent(project)}/_apis/testplan/plans`,
      method: 'GET',
      params: { filterActivePlans: true },
    });
    return data.value.map((p) => ({
      id: p.id as number,
      name: p.name as string,
      description: p.description as string | undefined,
      state: (p.state as 'Active' | 'Inactive') ?? 'Active',
      rootSuiteId: (p.rootSuite as { id: number } | undefined)?.id ?? 0,
      startDate: p.startDate as string | undefined,
      endDate: p.endDate as string | undefined,
    }));
  }

  async getPlan(project: string, planId: number): Promise<TestPlan> {
    const p = await this.req<Record<string, unknown>>({
      url: `/${encodeURIComponent(project)}/_apis/testplan/plans/${planId}`,
      method: 'GET',
    });
    return {
      id: p.id as number,
      name: p.name as string,
      description: p.description as string | undefined,
      state: (p.state as 'Active' | 'Inactive') ?? 'Active',
      rootSuiteId: (p.rootSuite as { id: number } | undefined)?.id ?? 0,
      startDate: p.startDate as string | undefined,
      endDate: p.endDate as string | undefined,
    };
  }

  async listSuites(project: string, planId: number): Promise<TestSuite[]> {
    const data = await this.req<{ value: Array<Record<string, unknown>> }>({
      url: `/${encodeURIComponent(project)}/_apis/testplan/Plans/${planId}/suites`,
      method: 'GET',
      params: { asTreeView: false },
    });
    return data.value.map((s) => ({
      id: s.id as number,
      name: s.name as string,
      planId,
      parentSuiteId: (s.parentSuite as { id: number } | undefined)?.id,
      suiteType:
        (s.suiteType as 'StaticTestSuite' | 'DynamicTestSuite' | 'RequirementTestSuite') ??
        'StaticTestSuite',
      testCaseCount: (s.testCaseCount as number | undefined) ?? 0,
    }));
  }

  async listTestCaseIdsInSuite(
    project: string,
    planId: number,
    suiteId: number,
  ): Promise<number[]> {
    const ids: number[] = [];
    let continuationToken: string | undefined;
    do {
      const data = await this.req<{
        value: Array<{ workItem: { id: number } }>;
        continuationToken?: string;
      }>({
        url: `/${encodeURIComponent(project)}/_apis/testplan/Plans/${planId}/Suites/${suiteId}/TestCase`,
        method: 'GET',
        params: {
          ...(continuationToken ? { continuationToken } : {}),
          excludeFlags: 0,
        },
      });
      for (const entry of data.value ?? []) {
        if (entry.workItem?.id) ids.push(entry.workItem.id);
      }
      continuationToken = data.continuationToken;
    } while (continuationToken);
    return ids;
  }

  async getWorkItemsBatch(project: string, ids: number[]): Promise<RawWorkItem[]> {
    if (!ids.length) return [];
    const results: RawWorkItem[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const data = await this.req<{ value: RawWorkItem[] }>({
        url: `/${encodeURIComponent(project)}/_apis/wit/workitemsbatch`,
        method: 'POST',
        data: {
          ids: chunk,
          fields: [
            'System.Id',
            'System.Rev',
            'System.Title',
            'System.State',
            'System.Tags',
            'System.AreaPath',
            'System.IterationPath',
            'System.AssignedTo',
            'System.Description',
            'System.WorkItemType',
            'System.CreatedDate',
            'System.ChangedDate',
            'System.ChangedBy',
            'Microsoft.VSTS.Common.Priority',
            'Microsoft.VSTS.TCM.Steps',
            'Microsoft.VSTS.TCM.LocalDataSource',
            'Microsoft.VSTS.TCM.Parameters',
            'Microsoft.VSTS.TCM.AutomationStatus',
            'Microsoft.VSTS.TCM.AutomatedTestName',
            'Microsoft.VSTS.TCM.AutomatedTestStorage',
            'Microsoft.VSTS.TCM.SystemInfo',
            'Microsoft.VSTS.Common.Preconditions',
          ],
          $expand: 'relations',
        },
      });
      results.push(...(data.value ?? []));
    }
    return results;
  }

  async getTestCases(project: string, ids: number[]): Promise<TestCase[]> {
    const raw = await this.getWorkItemsBatch(project, ids);
    return raw.map((w) => this.mapWorkItemToTestCase(w));
  }

  async getSharedSteps(project: string, ids: number[]): Promise<SharedStep[]> {
    const raw = await this.getWorkItemsBatch(project, ids);
    return raw.map((w) => this.mapWorkItemToSharedStep(w));
  }

  async getAttachment(url: string): Promise<Buffer> {
    const resp = await this.http.request<ArrayBuffer>({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
    });
    if (resp.status >= 400) {
      throw new ApiError(resp.status, url, `Attachment download failed: ${resp.status}`);
    }
    return Buffer.from(resp.data);
  }

  async patchTestCase(
    project: string,
    id: number,
    patches: Array<{ op: string; path: string; value: unknown }>,
    expectedRev?: number,
  ): Promise<TestCase> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json-patch+json',
    };
    if (expectedRev !== undefined) headers['If-Match'] = `W/"${expectedRev}"`;

    const w = await this.req<RawWorkItem>({
      url: `/${encodeURIComponent(project)}/_apis/wit/workitems/${id}`,
      method: 'PATCH',
      headers,
      data: patches,
      params: { bypassRules: false, validateOnly: false },
    });
    return this.mapWorkItemToTestCase(w);
  }

  private mapWorkItemToTestCase(w: RawWorkItem): TestCase {
    const f = w.fields ?? {};
    const stepsXml = (f[TEST_STEPS_FIELD] as string | undefined) ?? '';
    return {
      id: w.id,
      rev: w.rev,
      title: (f['System.Title'] as string | undefined) ?? `Test Case ${w.id}`,
      state: (f['System.State'] as string | undefined) ?? 'Design',
      priority: (f['Microsoft.VSTS.Common.Priority'] as number | undefined) ?? 3,
      areaPath: (f['System.AreaPath'] as string | undefined) ?? '',
      iterationPath: (f['System.IterationPath'] as string | undefined) ?? '',
      tags: parseTags(f['System.Tags'] as string | undefined),
      assignedTo: parseUserField(f['System.AssignedTo']),
      description: f['System.Description'] as string | undefined,
      preconditions: f['Microsoft.VSTS.Common.Preconditions'] as string | undefined,
      steps: parseStepsXml(stepsXml),
      automationStatus: f['Microsoft.VSTS.TCM.AutomationStatus'] as string | undefined,
      automatedTestName: f['Microsoft.VSTS.TCM.AutomatedTestName'] as string | undefined,
      createdDate: (f['System.CreatedDate'] as string | undefined) ?? new Date().toISOString(),
      changedDate: (f['System.ChangedDate'] as string | undefined) ?? new Date().toISOString(),
      changedBy: parseUserField(f['System.ChangedBy']),
      fields: f,
      attachments: extractAttachments(w),
      suiteIds: [],
      planIds: [],
    };
  }

  private mapWorkItemToSharedStep(w: RawWorkItem): SharedStep {
    const f = w.fields ?? {};
    const stepsXml = (f[SHARED_STEPS_FIELD] as string | undefined) ?? '';
    return {
      id: w.id,
      rev: w.rev,
      title: (f['System.Title'] as string | undefined) ?? `Shared Step ${w.id}`,
      steps: parseStepsXml(stepsXml),
      changedDate: (f['System.ChangedDate'] as string | undefined) ?? new Date().toISOString(),
    };
  }
}

function parseTags(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseUserField(field: unknown): string | undefined {
  if (!field) return undefined;
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field !== null && 'displayName' in field) {
    return (field as { displayName: string }).displayName;
  }
  return undefined;
}

function extractAttachments(w: RawWorkItem): AttachmentRef[] {
  if (!w.relations) return [];
  return w.relations
    .filter((r) => r.rel === ATTACHMENT_FIELD)
    .map((r) => {
      const name =
        ((r.attributes?.name as string | undefined) ??
          r.url.split('/').pop() ??
          'attachment') as string;
      const id = r.url.split('/').pop() ?? r.url;
      const size = r.attributes?.resourceSize as number | undefined;
      return { id, name, url: r.url, size };
    });
}

/**
 * Azure DevOps stores test steps as a stringified XML blob. Parse it to plain
 * objects so the rest of the system can treat steps uniformly. We use a small
 * targeted parser (no full XML lib) because the structure is well-known.
 */
export function parseStepsXml(xml: string): TestStep[] {
  if (!xml || !xml.trim()) return [];
  const steps: TestStep[] = [];

  const stepRegex = /<step[^>]*\bid="(\d+)"[^>]*\btype="([^"]+)"[^>]*>([\s\S]*?)<\/step>/gi;
  const compRefRegex =
    /<compref[^>]*\bid="(\d+)"[^>]*\bref="(\d+)"[^>]*>([\s\S]*?)<\/compref>/gi;

  for (const m of xml.matchAll(stepRegex)) {
    const id = Number(m[1]);
    const inner = m[3] ?? '';
    const parameterizedStrings = [...inner.matchAll(/<parameterizedString[^>]*>([\s\S]*?)<\/parameterizedString>/gi)];
    const action = stripHtml(decodeXml(parameterizedStrings[0]?.[1] ?? ''));
    const expected = stripHtml(decodeXml(parameterizedStrings[1]?.[1] ?? ''));
    steps.push({ id, action, expected, isSharedStep: false });
  }

  for (const m of xml.matchAll(compRefRegex)) {
    const id = Number(m[1]);
    const sharedStepId = Number(m[2]);
    steps.push({
      id,
      action: `[shared step #${sharedStepId}]`,
      expected: '',
      isSharedStep: true,
      sharedStepId,
    });
  }

  return steps.sort((a, b) => a.id - b.id);
}

export function extractSharedStepIds(xml: string): number[] {
  if (!xml) return [];
  const ids = new Set<number>();
  for (const m of xml.matchAll(/<compref[^>]*\bref="(\d+)"/gi)) {
    ids.add(Number(m[1]));
  }
  return [...ids];
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
