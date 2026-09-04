export type SourceType = 'rss' | 'arxiv' | 'github_release' | 'press_api' | 'web_scraper';
export type SourceTier = 'tier_1_primary' | 'tier_2_verified' | 'tier_3_aggregator' | 'tier_4_unverified';
export type VerificationStatus = 'unverified' | 'verified_primary' | 'verified_corroborated' | 'disputed' | 'debunked';
export type EvidenceEntailment = 'supports' | 'refutes' | 'inconclusive';
export type ArticleStatus = 'draft' | 'review_pending' | 'approved' | 'published' | 'rejected' | 'retracted';

export interface SourceDefinition {
  id: string;
  name: string;
  baseUrl: string;
  sourceType: SourceType;
  tier: SourceTier;
  reputationScore: number;
  isActive: boolean;
  pollingFrequencyMinutes: number;
}

export interface IngestedRawArticle {
  id: string;
  sourceId: string;
  canonicalUrl: string;
  title: string;
  authors: string[];
  cleanText: string;
  summaryExcerpt?: string;
  publishedAt?: Date;
  contentHash: string;
}

export interface ExtractedClaimItem {
  id?: string;
  claimText: string;
  claimType: 'benchmark_result' | 'product_release' | 'quote' | 'architecture' | 'policy_or_safety';
  sourceExcerpt: string;
  verificationStatus: VerificationStatus;
  confidenceScore: number;
}

export interface VerificationEvidenceItem {
  id?: string;
  claimId: string;
  sourceUrl: string;
  sourceName: string;
  sourceTier: SourceTier;
  verbatimExcerpt: string;
  entailment: EvidenceEntailment;
  rationale: string;
}

export interface SynthesizedArticleDraft {
  id?: string;
  storyClusterId: string;
  title: string;
  deck: string;
  slug: string;
  contentMarkdown: string;
  metaDescription: string;
  confidenceScore: number;
  nGramMaxSimilarity: number;
  readingTimeMinutes: number;
  citations: Array<{
    citationIndex: number;
    claimId: string;
    anchorText: string;
    primarySourceUrl: string;
    sourcePublisher: string;
  }>;
}

export interface AgentRunTelemetry {
  runId: string;
  agentName: string;
  version: string;
  modelProvider: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  status: 'success' | 'failed' | 'retrying';
  errorMessage?: string;
}
