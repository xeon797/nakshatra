import { z } from 'zod';
import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq, desc, gte, and, inArray } from 'drizzle-orm';
import { AiModelProvider } from '../../services/ai/provider';
import { getAiProvider } from '../../services/ai/factory';
import { AgentAuditLogger } from '../../services/research/audit-logger';

export interface RawArticleForClustering {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceTier: 'tier_1_primary' | 'tier_2_verified' | 'tier_3_aggregator';
  title: string;
  cleanText: string;
  summaryExcerpt: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  canonicalUrl: string;
}

export interface ClusteredStoryResult {
  story: typeof schema.stories.$inferSelect;
  linkedArticleIds: string[];
  primaryArticleId: string;
}

export const STOP_WORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'of', 'and', 'with', 'to', 'for', 'is', 'by',
  'at', 'from', 'as', 'its', 'it', 'has', 'have', 'had', 'be', 'are', 'was',
  'were', 'this', 'that', 'these', 'those', 'new', 'about', 'after', 'into',
  'over', 'via', 'out', 'up', 'down', 'all', 'more', 'how', 'why', 'what',
]);

const KNOWN_ENTITIES = [
  'gpt-4.5', 'gpt-4o', 'gpt-4', 'o1', 'o3', 'claude 3.7', 'claude 3.5', 'claude 3', 'sonnet',
  'haiku', 'opus', 'gemini 2.5', 'gemini 2.0', 'gemini 1.5', 'deepseek-r1', 'deepseek-v3',
  'deepseek', 'llama 3.3', 'llama 3', 'mistral', 'qwen', 'alphageometry', 'alphafold',
  'openai', 'anthropic', 'google deepmind', 'deepmind', 'meta ai', 'nvidia', 'hugging face',
  'apple', 'microsoft', 'cohere', 'groq', 'blackwell', 'h100', 'b200', 'cuda', 'transformer',
];

/**
 * Normalizes title text into filtered keyword tokens
 */
export function normalizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/(\d+)\.(\d+)/g, '$1-$2')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/**
 * Calculates Jaccard similarity coefficient between two token lists
 */
export function calculateJaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersectionCount = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersectionCount++;
    }
  }

  const unionCount = setA.size + setB.size - intersectionCount;
  return unionCount === 0 ? 0 : intersectionCount / unionCount;
}

/**
 * Extracts recognized high-signal AI entities from title or text
 */
export function extractEntities(text: string): Set<string> {
  const lower = text.toLowerCase();
  const found = new Set<string>();

  for (const entity of KNOWN_ENTITIES) {
    if (lower.includes(entity)) {
      found.add(entity);
    }
  }

  return found;
}

/**
 * Evaluates whether two raw articles meet fast lexical heuristics or temporal proximity
 */
export function checkHeuristicMatch(
  articleA: RawArticleForClustering,
  articleB: RawArticleForClustering
): boolean {
  // 1. Normalized Title Jaccard Similarity > 0.45
  const tokensA = normalizeTitle(articleA.title);
  const tokensB = normalizeTitle(articleB.title);
  const jaccard = calculateJaccardSimilarity(tokensA, tokensB);

  if (jaccard > 0.45) {
    return true;
  }

  // 2. Entity Overlap
  const entitiesA = extractEntities(articleA.title + ' ' + (articleA.summaryExcerpt || ''));
  const entitiesB = extractEntities(articleB.title + ' ' + (articleB.summaryExcerpt || ''));

  let sharedEntityCount = 0;
  for (const e of entitiesA) {
    if (entitiesB.has(e)) sharedEntityCount++;
  }

  if (sharedEntityCount >= 2) {
    return true;
  }

  // 3. Temporal Proximity (within 6h of a primary lab announcement) + 1 shared specific entity
  const isOnePrimary =
    articleA.sourceTier === 'tier_1_primary' || articleB.sourceTier === 'tier_1_primary';

  if (isOnePrimary && sharedEntityCount >= 1) {
    const timeA = (articleA.publishedAt || articleA.createdAt).getTime();
    const timeB = (articleB.publishedAt || articleB.createdAt).getTime();
    const diffHours = Math.abs(timeA - timeB) / (1000 * 60 * 60);

    if (diffHours <= 6) {
      return true;
    }
  }

  return false;
}

export const HIGH_RISK_KEYWORDS = [
  'lawsuit',
  'sued',
  'suing',
  'vulnerability',
  'vulnerabilities',
  'exploit',
  'zero-day',
  'leak',
  'leaked',
  'leaks',
  'subpoena',
  'investigation',
  'breach',
  'hack',
  'hacked',
  'antitrust',
  'regulatory crackdown',
  'copyright infringement',
  'safety incident',
  'jailbreak',
];

export function hasHighRiskKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return HIGH_RISK_KEYWORDS.some((kw) => {
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    return regex.test(lower);
  });
}

/**
 * Module 3: Triage Logic for Editorial Risk Classification & Gatekeeping
 */
export function determineEditorialStatus(
  riskLevel: 'low' | 'medium' | 'high',
  importanceScore: number
): 'auto_approved' | 'needs_review' | 'rejected' {
  if (riskLevel === 'low') {
    // Official product documentation, verified arXiv papers, developer tool updates
    return 'auto_approved';
  }

  if (riskLevel === 'medium') {
    // Benchmark claims, market acquisitions, competitive performance comparisons
    return 'needs_review';
  }

  // risk_level === 'high': Safety/security incidents, copyright/lawsuits, regulatory crackdowns, unverified leaks
  // -> strictly requires human review ALWAYS, never auto-approved
  return 'needs_review';
}

export const ClusterSynthesisSchema = z.object({
  isSameStory: z
    .boolean()
    .describe('True if these articles report on the exact same real-world event or announcement.'),
  matchingArticleIndices: z
    .array(z.number())
    .describe('0-indexed indices of the articles that belong to this exact story cluster.'),
  primaryArticleIndex: z
    .number()
    .describe('0-indexed index of the most authoritative primary source article.'),
  canonicalTitle: z
    .string()
    .max(255)
    .describe('Objective, journalistic headline synthesizing the story.'),
  summary: z
    .string()
    .describe('Comprehensive multi-source analytical summary synthesizing the core development.'),
  category: z
    .enum(['llm_release', 'research', 'infra', 'policy', 'agentic'])
    .describe('Primary news category.'),
  riskLevel: z
    .enum(['low', 'medium', 'high'])
    .describe(
      'Editorial risk level: low (official product docs, verified arXiv papers, dev tools), medium (benchmark claims, acquisitions, competitive performance), high (safety/security incidents, copyright/lawsuits, regulatory crackdowns, leaks).'
    ),
  importanceScore: z
    .number()
    .min(0)
    .max(100)
    .describe('Estimated industry importance score from 0 to 100.'),
  reasoning: z
    .string()
    .describe('Editorial rationale for clustering decision, category, and risk level.'),
});

export type ClusterSynthesisOutput = z.infer<typeof ClusterSynthesisSchema>;

export class HybridStoryClusteringAgent {
  private aiProvider: AiModelProvider;
  private logger: AgentAuditLogger;

  constructor(aiProvider?: AiModelProvider, logger?: AgentAuditLogger) {
    this.aiProvider = aiProvider || getAiProvider();
    this.logger = logger || new AgentAuditLogger();
  }

  /**
   * Fetches unclustered raw articles from the candidate window (default: last 36 hours)
   */
  async fetchUnclusteredArticles(windowHours = 36): Promise<RawArticleForClustering[]> {
    const db = await getDb();
    const cutoffDate = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    // Fetch existing linked raw article IDs from story_sources
    const linkedRows = await db
      .select({ rawArticleId: schema.storySources.rawArticleId })
      .from(schema.storySources);

    const linkedSet = new Set(linkedRows.map((r) => r.rawArticleId));

    // Fetch candidate raw articles with source tier metadata
    const candidates = await db
      .select({
        id: schema.rawArticles.id,
        sourceId: schema.rawArticles.sourceId,
        sourceName: schema.sources.name,
        sourceTier: schema.sources.tier,
        title: schema.rawArticles.title,
        cleanText: schema.rawArticles.cleanText,
        summaryExcerpt: schema.rawArticles.summaryExcerpt,
        publishedAt: schema.rawArticles.publishedAt,
        createdAt: schema.rawArticles.createdAt,
        canonicalUrl: schema.rawArticles.canonicalUrl,
      })
      .from(schema.rawArticles)
      .innerJoin(schema.sources, eq(schema.rawArticles.sourceId, schema.sources.id))
      .where(gte(schema.rawArticles.createdAt, cutoffDate))
      .orderBy(desc(schema.rawArticles.createdAt));

    return candidates
      .filter((c) => !linkedSet.has(c.id))
      .map((c) => ({
        ...c,
        sourceTier: c.sourceTier as RawArticleForClustering['sourceTier'],
      }));
  }

  /**
   * Partitions unclustered articles into candidate cluster groups via lexical & temporal heuristics
   */
  groupCandidatesIntoClusters(articles: RawArticleForClustering[]): RawArticleForClustering[][] {
    const clusters: RawArticleForClustering[][] = [];
    const assigned = new Set<string>();

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      if (assigned.has(article.id)) continue;

      const currentCluster: RawArticleForClustering[] = [article];
      assigned.add(article.id);

      for (let j = i + 1; j < articles.length; j++) {
        const candidate = articles[j];
        if (assigned.has(candidate.id)) continue;

        // Compare candidate against any article in the current cluster
        const matchesAny = currentCluster.some((member) => checkHeuristicMatch(member, candidate));
        if (matchesAny) {
          currentCluster.push(candidate);
          assigned.add(candidate.id);
        }
      }

      clusters.push(currentCluster);
    }

    return clusters;
  }

  /**
   * Evaluates a candidate cluster using LLM Semantic Verification & Editorial Synthesis
   */
  async verifyAndSynthesizeCluster(
    candidates: RawArticleForClustering[]
  ): Promise<ClusteredStoryResult | null> {
    if (candidates.length === 0) return null;

    const startTime = Date.now();
    let runId: string | undefined;

    try {
      runId = await this.logger.startRun({
        agentName: 'HybridStoryClusteringAgent',
        agentVersion: '2.0.0',
        modelProvider: this.aiProvider.providerName,
        modelName: this.aiProvider.defaultModel,
      });
    } catch {
      // Graceful fallback
    }

    const systemPrompt = `You are NAKSHATRA's Lead Story Clustering and Editorial Gatekeeping Agent.
Your job is to analyze candidate news articles and determine whether they report on the exact same real-world event or technical milestone.

CRITICAL RULES:
1. "isSameStory": True ONLY if the articles report on the exact same underlying event (e.g. same model release, same benchmark paper, same partnership).
2. "matchingArticleIndices": List 0-indexed numbers of the articles that belong to this cluster.
3. "primaryArticleIndex": Pick the most authoritative source (prefer tier_1_primary labs or primary documentation).
4. "canonicalTitle": Journalistic, non-sensational headline (max 255 chars).
5. "summary": Multi-source analytical summary synthesizing core facts and context.
6. "category": Choose one of 'llm_release', 'research', 'infra', 'policy', 'agentic'.
7. "riskLevel":
   - "low": Official product docs, verified arXiv papers, developer tool updates.
   - "medium": Benchmark claims, market acquisitions, competitive performance comparisons.
   - "high": Safety/security incidents, copyright/lawsuits, regulatory crackdowns, unverified leaks.
8. "importanceScore": Integer between 0 and 100.
9. "reasoning": Concise explanation of the editorial triage and clustering decision.`;

    const candidateListPrompt = candidates
      .map(
        (c, idx) =>
          `[Article ${idx}]
Title: ${c.title}
Source: ${c.sourceName} (${c.sourceTier})
Published: ${c.publishedAt ? c.publishedAt.toISOString() : c.createdAt.toISOString()}
URL: ${c.canonicalUrl}
Excerpt: ${c.summaryExcerpt || c.cleanText.substring(0, 300)}...`
      )
      .join('\n\n');

    const userPrompt = `Evaluate the following ${candidates.length} candidate article(s):\n\n${candidateListPrompt}\n\nDetermine whether they represent the same story, classify editorial risk, and synthesize canonical metadata.`;

    try {
      const response = await this.aiProvider.generateStructured(
        userPrompt,
        ClusterSynthesisSchema,
        {
          systemPrompt,
          temperature: 0.1,
        }
      );

      const decision = response.data;
      const durationMs = Date.now() - startTime;

      if (!decision.isSameStory) {
        if (runId) {
          await this.logger.finishRun(runId, {
            status: 'success',
            promptTokens: response.promptTokens,
            completionTokens: response.completionTokens,
            latencyMs: durationMs,
          });
        }
        return null;
      }

      // Identify matching candidate articles
      const matchingIndices =
        decision.matchingArticleIndices.length > 0
          ? decision.matchingArticleIndices.filter((idx) => idx >= 0 && idx < candidates.length)
          : [0];

      const matchingArticles = matchingIndices.map((idx) => candidates[idx]);
      if (matchingArticles.length === 0) return null;

      // Determine primary article
      let primaryArticle = candidates[decision.primaryArticleIndex];
      if (!primaryArticle || !matchingArticles.some((m) => m.id === primaryArticle.id)) {
        // Fallback: prefer Tier 1 primary or earliest article
        primaryArticle =
          matchingArticles.find((m) => m.sourceTier === 'tier_1_primary') || matchingArticles[0];
      }

      // Check for high-risk keywords across candidate headlines and summaries
      const combinedText = matchingArticles
        .map((c) => `${c.title} ${c.summaryExcerpt || ''}`)
        .join(' ') + ` ${decision.canonicalTitle} ${decision.summary}`;

      let effectiveRiskLevel = decision.riskLevel;
      if (hasHighRiskKeywords(combinedText)) {
        effectiveRiskLevel = 'high';
      }

      // Module 3: Triage editorial status
      const editorialStatus = determineEditorialStatus(
        effectiveRiskLevel,
        decision.importanceScore
      );

      // Determine timestamps
      const timestamps = matchingArticles.map((m) =>
        (m.publishedAt || m.createdAt).getTime()
      );
      const firstSeenAt = new Date(Math.min(...timestamps));
      const lastUpdatedAt = new Date(Math.max(...timestamps));

      // Persist Story in PostgreSQL
      const db = await getDb();
      const [insertedStory] = await db
        .insert(schema.stories)
        .values({
          title: decision.canonicalTitle,
          summary: decision.summary,
          category: decision.category,
          editorialStatus,
          riskLevel: effectiveRiskLevel,
          importanceScore: decision.importanceScore,
          firstSeenAt,
          lastUpdatedAt,
          primarySourceId: primaryArticle.sourceId,
        })
        .returning();

      // Persist story_sources junction rows
      for (const article of matchingArticles) {
        await db
          .insert(schema.storySources)
          .values({
            storyId: insertedStory.id,
            rawArticleId: article.id,
            isPrimary: article.id === primaryArticle.id,
          })
          .onConflictDoNothing();
      }

      if (runId) {
        await this.logger.logStep({
          agentRunId: runId,
          stepNumber: 1,
          actionName: 'cluster_and_synthesize',
          inputPayload: { candidateCount: candidates.length },
          outputPayload: {
            storyId: insertedStory.id,
            title: insertedStory.title,
            riskLevel: insertedStory.riskLevel,
            editorialStatus: insertedStory.editorialStatus,
            matchingSourcesCount: matchingArticles.length,
          },
          rationale: decision.reasoning,
        });

        await this.logger.finishRun(runId, {
          status: 'success',
          promptTokens: response.promptTokens,
          completionTokens: response.completionTokens,
          latencyMs: durationMs,
        });
      }

      return {
        story: insertedStory,
        linkedArticleIds: matchingArticles.map((m) => m.id),
        primaryArticleId: primaryArticle.id,
      };
    } catch (err: any) {
      if (runId) {
        await this.logger.finishRun(runId, {
          status: 'failed',
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: Date.now() - startTime,
          errorMessage: err.message || String(err),
        });
      }
      throw err;
    }
  }

  /**
   * Executes the full clustering pipeline across all unclustered articles in the candidate window
   */
  async runClusteringPipeline(windowHours = 36): Promise<ClusteredStoryResult[]> {
    const unclustered = await this.fetchUnclusteredArticles(windowHours);
    if (unclustered.length === 0) {
      return [];
    }

    const candidateGroups = this.groupCandidatesIntoClusters(unclustered);
    const results: ClusteredStoryResult[] = [];

    for (const group of candidateGroups) {
      const clusterResult = await this.verifyAndSynthesizeCluster(group);
      if (clusterResult) {
        results.push(clusterResult);
      }
    }

    return results;
  }

  /**
   * Alias for runClusteringPipeline matching Module 5 interface: Clusterer.processUnclustered()
   */
  async processUnclustered(windowHours = 36): Promise<ClusteredStoryResult[]> {
    return this.runClusteringPipeline(windowHours);
  }
}
