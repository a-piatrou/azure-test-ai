export interface TestStep {
  id: number;
  action: string;
  expected: string;
  isSharedStep: boolean;
  sharedStepId?: number;
  attachments?: AttachmentRef[];
}

export interface AttachmentRef {
  id: string;
  name: string;
  url: string;
  size?: number;
  localPath?: string;
}

export interface TestCase {
  id: number;
  rev: number;
  title: string;
  state: string;
  priority: number;
  areaPath: string;
  iterationPath: string;
  tags: string[];
  assignedTo?: string;
  description?: string;
  preconditions?: string;
  steps: TestStep[];
  automationStatus?: string;
  automatedTestName?: string;
  createdDate: string;
  changedDate: string;
  changedBy?: string;
  fields: Record<string, unknown>;
  attachments: AttachmentRef[];
  suiteIds: number[];
  planIds: number[];
}

export interface TestSuite {
  id: number;
  name: string;
  planId: number;
  parentSuiteId?: number;
  suiteType: 'StaticTestSuite' | 'DynamicTestSuite' | 'RequirementTestSuite';
  testCaseCount: number;
}

export interface TestPlan {
  id: number;
  name: string;
  description?: string;
  state: 'Active' | 'Inactive';
  rootSuiteId: number;
  startDate?: string;
  endDate?: string;
}

export interface SharedStep {
  id: number;
  rev: number;
  title: string;
  steps: TestStep[];
  changedDate: string;
}

export interface SyncState {
  version: 1;
  lastSyncAt: string;
  organization: string;
  projects: Record<string, ProjectSyncState>;
}

export interface ProjectSyncState {
  testCases: Record<number, TestCaseSyncEntry>;
  sharedSteps: Record<number, { rev: number; path: string }>;
  plans: Record<number, { rev?: number; path: string }>;
  suites: Record<number, { path: string; planId: number }>;
}

export interface TestCaseSyncEntry {
  rev: number;
  changedDate: string;
  hash: string;
  path: string;
  suiteIds: number[];
  planIds: number[];
  etag?: string;
}

export interface SyncResult {
  added: number[];
  updated: number[];
  unchanged: number[];
  deleted: number[];
  errors: SyncError[];
  durationMs: number;
  dryRun: boolean;
}

export interface SyncError {
  testCaseId?: number;
  stage: 'list' | 'fetch' | 'render' | 'write' | 'attachment';
  message: string;
  cause?: unknown;
}

export type QualityScore = {
  overall: number;
  signals: {
    hasSteps: boolean;
    hasExpectedResults: boolean;
    hasTags: boolean;
    hasDescription: boolean;
    hasPreconditions: boolean;
    stepCount: number;
    averageStepLength: number;
    ambiguityFlags: string[];
  };
  llm?: {
    score: number;
    rationale: string;
    suggestions: string[];
  };
};
