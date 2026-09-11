import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq, desc, or, sql, gte, inArray, and } from 'drizzle-orm';
import { IngestionService } from '../../services/ingestion/ingest-service';
import { RssFeedAdapter, ParsedFeedItem } from '../../services/ingestion/rss-adapter';
import {
  generateContentHash,
  computeSimHash,
  isNearDuplicate,
} from '../../services/ingestion/dedup';
import {
  HybridStoryClusteringAgent,
  RawArticleForClustering,
  checkHeuristicMatch,
  hasHighRiskKeywords,
  determineEditorialStatus,
} from '../agents/clusterer';
import { MultiSourceResearcherAgent } from '../agents/researcher';
import { MultiSourceWriterAgent } from '../agents/writer';
import { ensureDatabaseInitialized } from '../../db/init';
import { classifyHeadlineCategory } from '../diagnostics/source-diagnostic';
import { AiModelProvider } from '../../services/ai/provider';
import { getAiProvider } from '../../services/ai/factory';

export type PublicCategory = 'llm_release' | 'agentic' | 'infra' | 'research' | 'policy';

export interface CategoryQuota {
  min: number;
  max: number;
  target: number;
}

export const DEFAULT_BACKFILL_CATEGORY_TARGETS: Record<PublicCategory, CategoryQuota> = {
  llm_release: { min: 8, max: 12, target: 10 },
  agentic: { min: 6, max: 10, target: 8 },
  infra: { min: 6, max: 10, target: 8 },
  research: { min: 6, max: 10, target: 8 },
  policy: { min: 5, max: 8, target: 6 },
};

export interface HistoricalBackfillOptions {
  dryRun?: boolean;
  overlapHours?: number; // default: 240 (10 days)
  recentWindowLimit?: number; // default: 80 per source
  categoryTargets?: Partial<Record<PublicCategory, Partial<CategoryQuota>>>;
  interRequestDelayMs?: number; // default: 1200ms
  limit?: number; // Maximum total stories to synthesize & publish across all categories (e.g. 3)
  maxCandidatesPerSource?: number; // Maximum candidates to inspect per source
  maxArticlesSynthesized?: number; // Alias for limit
  geminiBudget?: number; // Configurable Gemini request budget (e.g. 6)
  deterministicEvidence?: boolean; // Use deterministic grounded evidence extraction (0 Gemini calls in research)
  aiProvider?: AiModelProvider;
  ingestionService?: IngestionService;
  clusterer?: HybridStoryClusteringAgent;
  researcher?: MultiSourceResearcherAgent;
  writer?: MultiSourceWriterAgent;
  onProgress?: (message: string) => void;
}

export interface SelectedStoryCandidate {
  id: string;
  title: string;
  category: PublicCategory;
  importanceScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  editorialStatus: 'auto_approved' | 'needs_review' | 'rejected' | 'published';
  sourceCount: number;
  primarySource: string;
  canonicalUrl: string;
  isAutoApproved: boolean;
}

export interface CategoryCoverageProgress {
  category: PublicCategory;
  candidatesDiscovered: number;
  clustersCreated: number;
  autoApprovedCount: number;
  existingPublished: number;
  selectedForSynthesis: number;
  targetRange: string;
  isViable: boolean;
}

export interface HistoricalBackfillReport {
  timestamp: string;
  isDryRun: boolean;
  windowHours: number;
  sourcesScanned: number;
  candidatesDiscovered: number;
  duplicatesRemoved: number;
  exactDuplicatesSkipped: number;
  nearDuplicatesSkipped: number;
  rawArticlesInserted: number;
  clustersCreated: number;
  storiesRejected: number;
  storiesHeldForReview: number;
  storiesAutoApproved: number;
  selectedForSynthesis: number;
  articlesSynthesized: number;
  articlesPublished: number;
  articlesBeforeBackfill: number;
  articlesAfterBackfill: number;
  categoryDistributionBefore: Record<PublicCategory, number>;
  categoryDistributionAfter: Record<PublicCategory, number>;
  preSynthesisCoverage: CategoryCoverageProgress[];
  selectedStoriesBreakdown: SelectedStoryCandidate[];
  errors: string[];
  totalElapsedMs?: number;
  geminiBudget?: number;
  geminiCallsUsed: number;
  budgetRemaining?: number;
  stoppedEarlyDueToBudget: boolean;
  phaseTimings: {
    rssIngestionMs: number;
    clusteringMs: number;
    categoryBalancingMs: number;
    jinaExtractionMs: number;
    geminiGenerationMs: number;
    dbPersistenceMs: number;
    verificationMs: number;
    totalElapsedMs: number;
  };
  callsPerStory?: Array<{
    storyTitle: string;
    category: string;
    geminiCalls: number;
    jinaCalls: number;
    jinaMs: number;
    geminiMs: number;
    status: string;
  }>;
  apiCalls?: {
    geminiCount: number;
    jinaCount: number;
    tavilyCount: number;
  };
}

export class HistoricalBackfillOrchestrator {
  private aiProvider: AiModelProvider;
  private ingestionService: IngestionService;
  private clusterer: HybridStoryClusteringAgent;
  private researcher: MultiSourceResearcherAgent;
  private writer: MultiSourceWriterAgent;
  private rssAdapter: RssFeedAdapter;

  constructor(dependencies?: {
    aiProvider?: AiModelProvider;
    ingestionService?: IngestionService;
    clusterer?: HybridStoryClusteringAgent;
    researcher?: MultiSourceResearcherAgent;
    writer?: MultiSourceWriterAgent;
    rssAdapter?: RssFeedAdapter;
  }) {
    this.aiProvider = dependencies?.aiProvider || getAiProvider();
    this.ingestionService = dependencies?.ingestionService || new IngestionService();
    this.clusterer = dependencies?.clusterer || new HybridStoryClusteringAgent(this.aiProvider);
    this.researcher = dependencies?.researcher || new MultiSourceResearcherAgent(this.aiProvider);
    this.writer = dependencies?.writer || new MultiSourceWriterAgent(this.aiProvider);
    this.rssAdapter = dependencies?.rssAdapter || new RssFeedAdapter();
  }

  /**
   * Executes a controlled 10-day historical content backfill.
   */
  async run(options?: HistoricalBackfillOptions): Promise<HistoricalBackfillReport> {
    const isDryRun = options?.dryRun ?? false;
    const windowHours = options?.overlapHours ?? 240; // 10 days
    const recentWindowLimit = options?.recentWindowLimit ?? 80;
    const delayMs = options?.interRequestDelayMs ?? 1200;
    const log = options?.onProgress || ((msg: string) => console.log(msg));

    const runStartTime = Date.now();
    const formatElapsed = () => {
      const totalSec = Math.floor((Date.now() - runStartTime) / 1000);
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    };

    let geminiCallCount = 0;
    let jinaCallCount = 0;
    const tavilyCallCount = 0;

    if (options?.geminiBudget !== undefined && 'setRequestBudget' in (this.aiProvider as unknown as Record<string, unknown>)) {
      (this.aiProvider as unknown as { setRequestBudget: (budget: number) => void }).setRequestBudget(options.geminiBudget);
    }

    let rssIngestionMs = 0;
    let clusteringMs = 0;
    let categoryBalancingMs = 0;
    let jinaExtractionMs = 0;
    let geminiGenerationMs = 0;
    const dbPersistenceMs = 0;
    let verificationMs = 0;
    let geminiCallsUsed = 0;
    let stoppedEarlyDueToBudget = false;
    const callsPerStory: Array<{
      storyTitle: string;
      category: string;
      geminiCalls: number;
      jinaCalls: number;
      jinaMs: number;
      geminiMs: number;
      status: string;
    }> = [];

    await ensureDatabaseInitialized();
    const db = await getDb();

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: Baseline Audit (Articles Before Backfill)
    // ─────────────────────────────────────────────────────────────────────────
    log(`[Phase 1/6: Baseline Audit] [1/1] [Auditing published articles in database] [${formatElapsed()}]`);

    const existingArticles = await db
      .select({
        id: schema.articles.id,
        title: schema.articles.title,
        status: schema.articles.status,
        storyId: schema.articles.storyId,
        category: schema.stories.category,
      })
      .from(schema.articles)
      .leftJoin(schema.stories, eq(schema.articles.storyId, schema.stories.id))
      .where(eq(schema.articles.status, 'published'));

    const categoryDistributionBefore: Record<PublicCategory, number> = {
      llm_release: 0,
      agentic: 0,
      infra: 0,
      research: 0,
      policy: 0,
    };

    for (const art of existingArticles) {
      const cat = (art.category as PublicCategory) || 'llm_release';
      if (categoryDistributionBefore[cat] !== undefined) {
        categoryDistributionBefore[cat]++;
      }
    }

    const articlesBeforeBackfill = existingArticles.length;
    log(`[Backfill] Initial state: ${articlesBeforeBackfill} published articles in database:`);
    for (const [cat, count] of Object.entries(categoryDistributionBefore)) {
      log(`  - ${cat}: ${count}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: Historical Ingestion from the Verified Sources
    // ─────────────────────────────────────────────────────────────────────────
    const phase2Start = Date.now();
    log(`\n[Phase 2/6: RSS Ingestion] [0/0] [Starting ${windowHours}h Historical Source Discovery] [${formatElapsed()}]`);

    const activeSources = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.isActive, true));

    const errors: string[] = [];
    let candidatesDiscovered = 0;
    let exactDuplicatesSkipped = 0;
    let nearDuplicatesSkipped = 0;
    let rawArticlesInserted = 0;

    // Temporary memory structures for dry-run mode
    const dryRunCandidateItems: Array<{
      item: ParsedFeedItem;
      source: typeof schema.sources.$inferSelect;
    }> = [];

    const now = Date.now();
    const cutoffDate = new Date(now - windowHours * 60 * 60 * 1000);

    for (let srcIdx = 0; srcIdx < activeSources.length; srcIdx++) {
      const source = activeSources[srcIdx];
      log(`[Phase 2/6: RSS Ingestion] [${srcIdx + 1}/${activeSources.length}] [Source: "${source.name}" (${source.tier})] [${formatElapsed()}]`);

      if (isDryRun) {
        // In Dry-Run mode: parse feed in memory, check DB duplicates without inserting
        try {
          const items = await this.rssAdapter.parseUrl(source.baseUrl);
          let sourceCandidates = 0;

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const isRecentIndex = i < recentWindowLimit;
            const isWithinTimeWindow =
              item.publishedAt && item.publishedAt.getTime() >= cutoffDate.getTime();

            if (!isRecentIndex && !isWithinTimeWindow) continue;

            candidatesDiscovered++;
            sourceCandidates++;

            // Check exact duplicate against DB
            const contentHash = generateContentHash(item.cleanText || item.rawContent || item.canonicalUrl);
            const [existing] = await db
              .select({ id: schema.rawArticles.id })
              .from(schema.rawArticles)
              .where(
                or(
                  eq(schema.rawArticles.canonicalUrl, item.canonicalUrl),
                  eq(schema.rawArticles.contentHash, contentHash)
                )
              )
              .limit(1);

            if (existing) {
              exactDuplicatesSkipped++;
            } else {
              dryRunCandidateItems.push({ item, source });
            }
          }
          log(`  -> Discovered ${sourceCandidates} candidates (${dryRunCandidateItems.length} novel in dry-run buffer)`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`Dry-run poll error for ${source.name}: ${message}`);
          log(`  -> Error polling ${source.name}: ${message}`);
        }
      } else {
        // In Real mode: ingest into PostgreSQL rawArticles
        try {
          const res = await this.ingestionService.ingestSource(source, {
            overlapHours: windowHours,
            recentWindowLimit,
          });

          candidatesDiscovered += res.candidatesInspected;
          exactDuplicatesSkipped += res.exactDuplicatesSkipped;
          nearDuplicatesSkipped += res.nearDuplicatesSkipped;
          rawArticlesInserted += res.insertedCount;

          if (res.errors.length > 0) {
            errors.push(...res.errors);
          }
          log(`  -> Inserted: ${res.insertedCount} | Exact dupes: ${res.exactDuplicatesSkipped} | Near dupes: ${res.nearDuplicatesSkipped}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`Ingestion error for ${source.name}: ${message}`);
          log(`  -> Error ingesting ${source.name}: ${message}`);
        }
      }
    }

    const duplicatesRemoved = exactDuplicatesSkipped + nearDuplicatesSkipped;
    rssIngestionMs = Date.now() - phase2Start;
    log(`[Backfill] Phase 2 complete. Candidates: ${candidatesDiscovered}, Duplicates Skipped: ${duplicatesRemoved}, Raw Novel: ${isDryRun ? dryRunCandidateItems.length : rawArticlesInserted} (${(rssIngestionMs / 1000).toFixed(1)}s)`);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3: Story Clustering & Editorial Triage
    // ─────────────────────────────────────────────────────────────────────────
    const phase3Start = Date.now();
    log(`\n[Phase 3/6: Story Clustering] [0/0] [Initializing Story Clustering & Editorial Triage] [${formatElapsed()}]`);

    let clustersCreated = 0;
    let storiesRejected = 0;
    let storiesHeldForReview = 0;
    let storiesAutoApproved = 0;

    const availableStoryCandidates: SelectedStoryCandidate[] = [];

    if (isDryRun) {
      // In dry-run mode, cluster both in-memory discovered candidates and any existing unclustered articles in DB
      const dbUnclustered = await this.clusterer.fetchUnclusteredArticles(windowHours);
      const rawCandidatesForClustering: RawArticleForClustering[] = [
        ...dryRunCandidateItems.map(({ item, source }, idx) => ({
          id: `dry-run-${idx}`,
          sourceId: source.id,
          sourceName: source.name,
          sourceTier: source.tier as RawArticleForClustering['sourceTier'],
          title: item.title,
          cleanText: item.cleanText,
          summaryExcerpt: item.summaryExcerpt || null,
          publishedAt: item.publishedAt || new Date(),
          createdAt: new Date(),
          canonicalUrl: item.canonicalUrl,
        })),
        ...dbUnclustered,
      ];

      const candidateGroups = this.clusterer.groupCandidatesIntoClusters(rawCandidatesForClustering);

      // Prioritize candidate groups: multi-source clusters first, then authoritative source tier
      const prioritizedGroups = [...candidateGroups].sort((a, b) => {
        if (b.length !== a.length) return b.length - a.length;
        const tierRank = (tier?: string) => (tier === 'tier_1_primary' ? 3 : tier === 'tier_2_verified' ? 2 : 1);
        const rankA = Math.max(...a.map((m) => tierRank(m.sourceTier)));
        const rankB = Math.max(...b.map((m) => tierRank(m.sourceTier)));
        return rankB - rankA;
      });

      // Distribute into 5 categories with a cap of 25 groups per category
      const groupsByCategory: Record<PublicCategory, RawArticleForClustering[][]> = {
        llm_release: [],
        agentic: [],
        infra: [],
        research: [],
        policy: [],
      };

      for (const group of prioritizedGroups) {
        const primaryArticle = group.find((m) => m.sourceTier === 'tier_1_primary') || group[0];
        const cat = classifyHeadlineCategory(
          primaryArticle.title,
          primaryArticle.summaryExcerpt || primaryArticle.cleanText.substring(0, 300),
          undefined
        );
        if (groupsByCategory[cat].length < 25) {
          groupsByCategory[cat].push(group);
        }
      }

      const filteredGroups = Object.values(groupsByCategory).flat();
      clustersCreated = filteredGroups.length;

      for (const group of filteredGroups) {
        const primaryArticle = group[0];
        const combinedText = group
          .map((c) => `${c.title} ${c.summaryExcerpt || c.cleanText.substring(0, 300)}`)
          .join(' ');

        // Determine category using headline classification + source category
        const category = classifyHeadlineCategory(
          primaryArticle.title,
          primaryArticle.summaryExcerpt || primaryArticle.cleanText.substring(0, 300),
          (primaryArticle.sourceTier === 'tier_1_primary' ? 'llm_release' : undefined)
        );

        // Risk classification
        const isHighRisk = hasHighRiskKeywords(combinedText);
        const riskLevel = isHighRisk ? 'high' : 'low';

        // Importance scoring
        const isMultiSource = group.length > 1;
        const tierBonus =
          primaryArticle.sourceTier === 'tier_1_primary'
            ? 25
            : primaryArticle.sourceTier === 'tier_2_verified'
            ? 15
            : 5;
        const importanceScore = Math.min(100, 50 + (isMultiSource ? 25 : 0) + tierBonus);

        const editorialStatus = determineEditorialStatus(riskLevel, importanceScore);

        if (editorialStatus === 'rejected') {
          storiesRejected++;
        } else if (editorialStatus === 'needs_review') {
          storiesHeldForReview++;
        } else if (editorialStatus === 'auto_approved') {
          storiesAutoApproved++;
        }

        availableStoryCandidates.push({
          id: primaryArticle.id,
          title: primaryArticle.title,
          category,
          importanceScore,
          riskLevel,
          editorialStatus,
          sourceCount: group.length,
          primarySource: primaryArticle.sourceName,
          canonicalUrl: primaryArticle.canonicalUrl,
          isAutoApproved: editorialStatus === 'auto_approved',
        });
      }
    } else {
      // In Real mode: process unclustered articles in PostgreSQL
      const unclustered = await this.clusterer.fetchUnclusteredArticles(windowHours);
      log(`[Backfill] Unclustered raw articles found in database: ${unclustered.length}`);

      if (unclustered.length > 0) {
        const candidateGroups = this.clusterer.groupCandidatesIntoClusters(unclustered);
        log(`[Backfill] Formed ${candidateGroups.length} candidate cluster groups from unclustered articles.`);

        // Prioritize candidate groups: multi-source clusters first, then authoritative source tier
        const prioritizedGroups = [...candidateGroups].sort((a, b) => {
          if (b.length !== a.length) return b.length - a.length;
          const tierRank = (tier?: string) => (tier === 'tier_1_primary' ? 3 : tier === 'tier_2_verified' ? 2 : 1);
          const rankA = Math.max(...a.map((m) => tierRank(m.sourceTier)));
          const rankB = Math.max(...b.map((m) => tierRank(m.sourceTier)));
          return rankB - rankA;
        });

        // Distribute into 5 categories with a cap of 25 groups per category
        const groupsByCategory: Record<PublicCategory, RawArticleForClustering[][]> = {
          llm_release: [],
          agentic: [],
          infra: [],
          research: [],
          policy: [],
        };

        for (const group of prioritizedGroups) {
          const primaryArticle = group.find((m) => m.sourceTier === 'tier_1_primary') || group[0];
          const cat = classifyHeadlineCategory(
            primaryArticle.title,
            primaryArticle.summaryExcerpt || primaryArticle.cleanText.substring(0, 300),
            undefined
          );
          if (groupsByCategory[cat].length < 25) {
            groupsByCategory[cat].push(group);
          }
        }

        const filteredGroups = Object.values(groupsByCategory).flat();
        log(`[Backfill] Selected ${filteredGroups.length} high-signal candidate groups across 5 categories for editorial clustering.`);

        for (const group of filteredGroups) {
          const primaryArticle = group.find((m) => m.sourceTier === 'tier_1_primary') || group[0];
          const combinedText = group
            .map((c) => `${c.title} ${c.summaryExcerpt || c.cleanText.substring(0, 300)}`)
            .join(' ');

          const category = classifyHeadlineCategory(
            primaryArticle.title,
            primaryArticle.summaryExcerpt || primaryArticle.cleanText.substring(0, 300),
            undefined
          );

          const isHighRisk = hasHighRiskKeywords(combinedText);
          const riskLevel: 'low' | 'medium' | 'high' = isHighRisk ? 'high' : 'low';

          const isMultiSource = group.length > 1;
          const tierBonus =
            primaryArticle.sourceTier === 'tier_1_primary'
              ? 25
              : primaryArticle.sourceTier === 'tier_2_verified'
              ? 15
              : 5;
          const importanceScore = Math.min(100, 55 + (isMultiSource ? 20 : 0) + tierBonus);

          const editorialStatus = determineEditorialStatus(riskLevel, importanceScore);

          if (editorialStatus === 'rejected') {
            storiesRejected++;
          } else if (editorialStatus === 'needs_review') {
            storiesHeldForReview++;
          } else if (editorialStatus === 'auto_approved') {
            storiesAutoApproved++;
          }

          // Persist story record in PostgreSQL
          const timestamps = group.map((m) => (m.publishedAt || m.createdAt).getTime());
          const firstSeenAt = new Date(Math.min(...timestamps));
          const lastUpdatedAt = new Date(Math.max(...timestamps));

          const [insertedStory] = await db
            .insert(schema.stories)
            .values({
              title: primaryArticle.title,
              summary: primaryArticle.summaryExcerpt || primaryArticle.cleanText.substring(0, 400),
              category,
              editorialStatus,
              riskLevel,
              importanceScore,
              firstSeenAt,
              lastUpdatedAt,
              primarySourceId: primaryArticle.sourceId,
            })
            .returning();

          clustersCreated++;

          // Link raw articles in story_sources
          for (const article of group) {
            await db
              .insert(schema.storySources)
              .values({
                storyId: insertedStory.id,
                rawArticleId: article.id,
                isPrimary: article.id === primaryArticle.id,
              })
              .onConflictDoNothing();
          }

          availableStoryCandidates.push({
            id: insertedStory.id,
            title: insertedStory.title,
            category: insertedStory.category as PublicCategory,
            importanceScore: insertedStory.importanceScore,
            riskLevel: insertedStory.riskLevel as 'low' | 'medium' | 'high',
            editorialStatus: insertedStory.editorialStatus as 'auto_approved' | 'needs_review' | 'rejected' | 'published',
            sourceCount: group.length,
            primarySource: primaryArticle.sourceName,
            canonicalUrl: primaryArticle.canonicalUrl,
            isAutoApproved: insertedStory.editorialStatus === 'auto_approved',
          });
        }
      }

      // Also include existing un-synthesized stories in the database
      const existingStories = await db
        .select({
          story: schema.stories,
          sourceName: schema.sources.name,
          canonicalUrl: schema.rawArticles.canonicalUrl,
        })
        .from(schema.stories)
        .leftJoin(schema.sources, eq(schema.stories.primarySourceId, schema.sources.id))
        .leftJoin(schema.storySources, eq(schema.stories.id, schema.storySources.storyId))
        .leftJoin(schema.rawArticles, eq(schema.storySources.rawArticleId, schema.rawArticles.id))
        .where(
          and(
            eq(schema.stories.editorialStatus, 'auto_approved'),
            or(
              gte(schema.stories.firstSeenAt, cutoffDate),
              gte(schema.stories.lastUpdatedAt, cutoffDate)
            )
          )
        );

      // Deduplicate story IDs
      const storyMap = new Map<string, typeof existingStories[0]>();
      for (const s of existingStories) {
        if (!storyMap.has(s.story.id)) {
          storyMap.set(s.story.id, s);
        }
      }

      for (const { story, sourceName, canonicalUrl } of storyMap.values()) {
        if (!availableStoryCandidates.some((c) => c.id === story.id)) {
          availableStoryCandidates.push({
            id: story.id,
            title: story.title,
            category: story.category as PublicCategory,
            importanceScore: story.importanceScore,
            riskLevel: story.riskLevel as 'low' | 'medium' | 'high',
            editorialStatus: story.editorialStatus as 'auto_approved' | 'needs_review' | 'rejected' | 'published',
            sourceCount: 1,
            primarySource: sourceName || 'Verified Source',
            canonicalUrl: canonicalUrl || '',
            isAutoApproved: story.editorialStatus === 'auto_approved',
          });
          storiesAutoApproved++;
        }
      }
    }

    clusteringMs = Date.now() - phase3Start;
    log(`[Phase 3 complete] Clusters formed: ${clustersCreated} | Auto-approved: ${storiesAutoApproved} | Review held: ${storiesHeldForReview} | Rejected: ${storiesRejected} (${(clusteringMs / 1000).toFixed(1)}s)`);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4: Category Balancing & Editorial Backlog Selection
    // ─────────────────────────────────────────────────────────────────────────
    const phase4Start = Date.now();
    const executionLimit = options?.limit ?? options?.maxArticlesSynthesized;
    log(`\n[Phase 4/6: Category Balancing] [1/1] [Balancing 5 categories (limit=${executionLimit ?? 'target quotas'})] [${formatElapsed()}]`);

    const selectedStories: SelectedStoryCandidate[] = [];
    const preSynthesisCoverage: CategoryCoverageProgress[] = [];

    const categories: PublicCategory[] = ['llm_release', 'agentic', 'infra', 'research', 'policy'];

    for (const category of categories) {
      const quota = {
        ...DEFAULT_BACKFILL_CATEGORY_TARGETS[category],
        ...(options?.categoryTargets?.[category] || {}),
      };

      const existingCount = categoryDistributionBefore[category] || 0;
      // Calculate how many more articles are needed to hit the target
      const neededCount = Math.max(0, quota.target - existingCount);
      const minNeeded = Math.max(0, quota.min - existingCount);

      // Filter eligible auto-approved candidate stories in this category
      const categoryCandidates = availableStoryCandidates
        .filter((s) => s.category === category && s.isAutoApproved)
        // Sort by quality: multi-source first, then importance score desc
        .sort((a, b) => {
          if (b.sourceCount !== a.sourceCount) {
            return b.sourceCount - a.sourceCount;
          }
          return b.importanceScore - a.importanceScore;
        });

      // Select stories up to the needed quota (bounded by max)
      const allowedCap = Math.min(quota.max - existingCount, neededCount);
      const selectedForCategory = categoryCandidates.slice(0, Math.max(minNeeded, allowedCap));

      selectedStories.push(...selectedForCategory);

      preSynthesisCoverage.push({
        category,
        candidatesDiscovered: availableStoryCandidates.filter((s) => s.category === category).length,
        clustersCreated: availableStoryCandidates.filter((s) => s.category === category).length,
        autoApprovedCount: categoryCandidates.length,
        existingPublished: existingCount,
        selectedForSynthesis: selectedForCategory.length,
        targetRange: `${quota.min}–${quota.max}`,
        isViable: existingCount + selectedForCategory.length >= quota.min,
      });
    }

    // Apply strict execution limit if specified (e.g. test mode --limit=3)
    let finalSelectedStories = selectedStories;
    if (typeof executionLimit === 'number' && executionLimit > 0 && selectedStories.length > executionLimit) {
      const limited: SelectedStoryCandidate[] = [];
      const seenCategories = new Set<string>();
      // First pass: distinct categories for balanced representation
      for (const s of selectedStories) {
        if (!seenCategories.has(s.category) && limited.length < executionLimit) {
          limited.push(s);
          seenCategories.add(s.category);
        }
      }
      // Second pass: fill remaining slots up to executionLimit
      for (const s of selectedStories) {
        if (limited.length >= executionLimit) break;
        if (!limited.some((item) => item.id === s.id)) {
          limited.push(s);
        }
      }
      finalSelectedStories = limited;
      log(`[Phase 4/6: Category Balancing] Execution limit active: Bounded to ${finalSelectedStories.length} stories across ${seenCategories.size} categories.`);
    }

    // Output Pre-Synthesis Category Coverage Report
    log('\n================================================================================');
    log('PRE-SYNTHESIS CATEGORY COVERAGE REPORT');
    log('================================================================================');
    log('Category     | Candidates | Auto-Approved | Existing | Selected | Final Projected | Target Range | Status');
    log('-------------------------------------------------------------------------------------------------------');
    for (const cov of preSynthesisCoverage) {
      const finalProjected = cov.existingPublished + cov.selectedForSynthesis;
      const statusStr = cov.isViable ? 'VIABLE' : 'NEEDS ATTENTION';
      log(
        `${cov.category.padEnd(12)} | ${String(cov.candidatesDiscovered).padStart(10)} | ${String(cov.autoApprovedCount).padStart(13)} | ${String(cov.existingPublished).padStart(8)} | ${String(cov.selectedForSynthesis).padStart(8)} | ${String(finalProjected).padStart(15)} | ${cov.targetRange.padStart(12)} | ${statusStr}`
      );
    }
    log('================================================================================');
    const allViable = preSynthesisCoverage.every((c) => c.isViable);
    categoryBalancingMs = Date.now() - phase4Start;
    log(`Viability Verdict: ${allViable ? 'ALL 5 CATEGORIES HAVE VIABLE SELECTED STORIES' : 'PARTIAL COVERAGE'} (${(categoryBalancingMs / 1000).toFixed(1)}s)\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 5: Synthesis & Publication (Real Execution Only)
    // ─────────────────────────────────────────────────────────────────────────
    let articlesSynthesized = 0;
    let articlesPublished = 0;

    if (isDryRun) {
      log(`[Backfill DRY-RUN] Dry run active. Skipping article writing, synthesis, and publication.`);
      log(`[Backfill DRY-RUN] Total stories that would be synthesized: ${finalSelectedStories.length}`);
    } else {
      log(`[Phase 5/6: Synthesis] [0/${finalSelectedStories.length}] [Starting controlled synthesis of ${finalSelectedStories.length} stories] [${formatElapsed()}]`);

      for (let i = 0; i < finalSelectedStories.length; i++) {
        const candidate = finalSelectedStories[i];
        const currentNum = i + 1;
        const totalNum = finalSelectedStories.length;
        log(`\n[Phase 5/6: Synthesis] [${currentNum}/${totalNum}] [Story: "${candidate.title}" (${candidate.category})] [${formatElapsed()}]`);

        // Check if article already exists for this story (Idempotency)
        const [existingArticle] = await db
          .select({ id: schema.articles.id, status: schema.articles.status })
          .from(schema.articles)
          .where(eq(schema.articles.storyId, candidate.id))
          .limit(1);

        if (existingArticle && existingArticle.status === 'published') {
          log(`  -> Already published article found (${existingArticle.id}). Skipping for idempotency.`);
          articlesPublished++;
          continue;
        }

        const storyCallStats = {
          storyTitle: candidate.title,
          category: candidate.category,
          geminiCalls: 0,
          jinaCalls: 0,
          jinaMs: 0,
          geminiMs: 0,
          status: 'pending',
        };
        callsPerStory.push(storyCallStats);

        try {
          // 1. Build evidence packet
          const evStart = Date.now();
          log(`  ├─ [1/3 Evidence Gathering] Extracting source markdown via Jina Reader...`);
          const evidencePacket = await this.researcher.buildEvidencePacket(candidate.id, {
            deterministicOnly: options?.deterministicEvidence !== false,
          });
          const evDuration = Date.now() - evStart;
          const jinaCalls = evidencePacket.primarySources.length + Math.min(1, evidencePacket.secondarySources.length);
          jinaCallCount += jinaCalls;
          jinaExtractionMs += evDuration;
          storyCallStats.jinaCalls = jinaCalls;
          storyCallStats.jinaMs = evDuration;

          const researchGeminiCalls = options?.deterministicEvidence === false ? 2 : 0;
          geminiCallCount += researchGeminiCalls;
          geminiCallsUsed += researchGeminiCalls;
          storyCallStats.geminiCalls += researchGeminiCalls;

          log(`  ├─ [Evidence Complete] ${evidencePacket.primarySources.length} primary, ${evidencePacket.secondarySources.length} secondary sources (${evDuration}ms)`);

          // Check Gemini budget before invoking expensive LLM synthesis
          if (options?.geminiBudget !== undefined && geminiCallsUsed >= options.geminiBudget) {
            log(`  └─ [Gemini Budget Limit] Configured budget (${options.geminiBudget}) reached before synthesis. Halting remaining stories gracefully.`);
            stoppedEarlyDueToBudget = true;
            storyCallStats.status = 'skipped_budget';
            break;
          }

          // 2. Synthesize long-form bilingual article
          const synthStart = Date.now();
          log(`  ├─ [2/3 Editorial Synthesis] Synthesizing bilingual journalistic article via Gemini...`);
          const savedArticle = await this.writer.synthesizeStoryArticle(evidencePacket, {
            publicationIntent: 'published',
          });
          const synthDuration = Date.now() - synthStart;
          geminiCallCount += 1;
          geminiCallsUsed += 1;
          geminiGenerationMs += synthDuration;
          storyCallStats.geminiCalls += 1;
          storyCallStats.geminiMs = synthDuration;
          articlesSynthesized++;

          if (savedArticle.status === 'published') {
            articlesPublished++;
            storyCallStats.status = 'published';
            log(`  └─ [3/3 Published] "${savedArticle.title}" (slug: /article/${savedArticle.slug}, synthesis: ${synthDuration}ms)`);
          } else {
            storyCallStats.status = 'draft';
            log(`  └─ [3/3 Saved Draft] "${savedArticle.title}" (status: ${savedArticle.status}, synthesis: ${synthDuration}ms)`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`Synthesis error on "${candidate.title}": ${message}`);
          storyCallStats.status = 'failed';
          log(`  └─ [FAILED Synthesis] [${candidate.title}]: ${message}`);

          // Update story failure reason
          try {
            await db
              .update(schema.stories)
              .set({
                processingStatus: 'failed',
                failureReason: message,
                lastAttemptedAt: new Date(),
              })
              .where(eq(schema.stories.id, candidate.id));
          } catch {
            // Ignore failure update error
          }

          const errorName = (err as { name?: string })?.name;
          if (
            errorName === 'GeminiBudgetExceededError' ||
            errorName === 'GeminiQuotaExhaustedError' ||
            message.includes('GeminiQuotaExhaustedError') ||
            message.includes('GeminiBudgetExceededError') ||
            message.includes('Quota exceeded') ||
            message.includes('429')
          ) {
            stoppedEarlyDueToBudget = true;
            log(`  └─ [Quota/Budget Stop] Gemini quota exhausted or budget limit reached. Halting remaining stories gracefully.`);
            break;
          }
        }

        // Pacing delay between Gemini API calls to respect rate limits
        if (i < finalSelectedStories.length - 1 && delayMs > 0) {
          log(`  -> Pacing delay: waiting ${delayMs}ms before next story...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 6: Post-Backfill Database Verification
    // ─────────────────────────────────────────────────────────────────────────
    const phase6Start = Date.now();
    log(`\n[Phase 6/6: Verification] [1/1] [Auditing final published database state] [${formatElapsed()}]`);

    const finalPublishedArticles = await db
      .select({
        id: schema.articles.id,
        category: schema.stories.category,
      })
      .from(schema.articles)
      .leftJoin(schema.stories, eq(schema.articles.storyId, schema.stories.id))
      .where(eq(schema.articles.status, 'published'));

    const categoryDistributionAfter: Record<PublicCategory, number> = {
      llm_release: 0,
      agentic: 0,
      infra: 0,
      research: 0,
      policy: 0,
    };

    for (const art of finalPublishedArticles) {
      const cat = (art.category as PublicCategory) || 'llm_release';
      if (categoryDistributionAfter[cat] !== undefined) {
        categoryDistributionAfter[cat]++;
      }
    }

    const articlesAfterBackfill = isDryRun ? articlesBeforeBackfill : finalPublishedArticles.length;
    verificationMs = Date.now() - phase6Start;
    const totalElapsedMs = Date.now() - runStartTime;

    log(`[Phase 6/6: Verification] Final Verified Database State:`);
    log(`  - Total Published Articles: ${articlesAfterBackfill}`);
    for (const [cat, count] of Object.entries(categoryDistributionAfter)) {
      log(`  - ${cat}: ${count}`);
    }
    log(`  - Total Elapsed Time: ${(totalElapsedMs / 1000).toFixed(1)}s`);
    log(`  - Total API Calls (Est): Gemini: ${geminiCallCount}, Jina: ${jinaCallCount}`);

    return {
      timestamp: new Date().toISOString(),
      isDryRun,
      windowHours,
      sourcesScanned: activeSources.length,
      candidatesDiscovered,
      duplicatesRemoved,
      exactDuplicatesSkipped,
      nearDuplicatesSkipped,
      rawArticlesInserted,
      clustersCreated,
      storiesRejected,
      storiesHeldForReview,
      storiesAutoApproved,
      selectedForSynthesis: finalSelectedStories.length,
      articlesSynthesized,
      articlesPublished,
      articlesBeforeBackfill,
      articlesAfterBackfill,
      categoryDistributionBefore,
      categoryDistributionAfter,
      preSynthesisCoverage,
      selectedStoriesBreakdown: finalSelectedStories,
      errors,
      totalElapsedMs,
      geminiBudget: options?.geminiBudget,
      geminiCallsUsed,
      budgetRemaining: options?.geminiBudget !== undefined ? Math.max(0, options.geminiBudget - geminiCallsUsed) : undefined,
      stoppedEarlyDueToBudget,
      phaseTimings: {
        rssIngestionMs,
        clusteringMs,
        categoryBalancingMs,
        jinaExtractionMs,
        geminiGenerationMs,
        dbPersistenceMs,
        verificationMs,
        totalElapsedMs,
      },
      callsPerStory,
      apiCalls: {
        geminiCount: geminiCallCount,
        jinaCount: jinaCallCount,
        tavilyCount: tavilyCallCount,
      },
    };
  }
}
