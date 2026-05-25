export type SuggestionKind =
  | 'add-step'
  | 'rewrite-step'
  | 'delete-step'
  | 'add-precondition'
  | 'rewrite-precondition'
  | 'add-tag'
  | 'rewrite-title'
  | 'add-expected'
  | 'rewrite-expected'
  | 'add-description'
  | 'add-automation-note';

export interface ReviewSuggestion {
  id: string;
  kind: SuggestionKind;
  /**
   * 1 (low) — 5 (high). The reviewer's confidence that this change is correct
   * and helpful. Used by `review-apply --accept-above N`.
   */
  confidence: 1 | 2 | 3 | 4 | 5;
  targetStepId?: number;
  before?: string;
  after: string;
  rationale: string;
  evidence?: {
    screenshot?: string;
    actualOutcome?: string;
    selector?: string;
  };
}

export interface ReviewArtifact {
  version: 1;
  testCaseId: number;
  testCaseRev: number;
  testCaseHash: string;
  reviewedAt: string;
  reviewer: 'claude' | 'human' | 'hybrid';
  model?: string;
  baseUrl?: string;
  outcome: 'pass' | 'fail' | 'partial' | 'inconclusive';
  durationMs?: number;
  suggestions: ReviewSuggestion[];
  decisions?: Record<string, 'accepted' | 'rejected' | 'pending'>;
  appliedAt?: string;
  syncedBackAt?: string;
  traceFile?: string;
}

export interface ReviewStatus {
  testCaseId: number;
  title: string;
  suggestionCount: number;
  pending: number;
  accepted: number;
  rejected: number;
  averageConfidence: number;
  outcome: ReviewArtifact['outcome'];
  reviewedAt: string;
  appliedAt?: string;
  syncedBackAt?: string;
}
