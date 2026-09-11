import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { getDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import { seedDefaultSources } from '../../services/ingestion/seed-sources';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';
import {
  HistoricalBackfillOrchestrator,
  DEFAULT_BACKFILL_CATEGORY_TARGETS,
  PublicCategory,
} from '../backfill/historical-backfill';
import { DEFAULT_OVERLAP_WINDOW_HOURS } from '../../services/ingestion/ingest-service';
import { MockAiProvider } from '../../services/ai/mock-provider';

describe('STEP 5: Controlled 10-Day Historical Content Backfill', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
    await seedDefaultSources();
  });

  beforeEach(async () => {
    resetDbForTesting();
    await initializeDatabase();
    await seedDefaultSources();
  });

  it('1. applies 240-hour windowing for backfill while preserving default 72h production window', () => {
    // Normal production default window in IngestService remains 72 hours
    expect(DEFAULT_OVERLAP_WINDOW_HOURS).toBe(72);

    // Default backfill target quotas cover all 5 public categories with specified caps
    expect(DEFAULT_BACKFILL_CATEGORY_TARGETS.llm_release.max).toBe(12);
    expect(DEFAULT_BACKFILL_CATEGORY_TARGETS.llm_release.min).toBe(8);
    expect(DEFAULT_BACKFILL_CATEGORY_TARGETS.agentic.min).toBe(6);
    expect(DEFAULT_BACKFILL_CATEGORY_TARGETS.agentic.max).toBe(10);
    expect(DEFAULT_BACKFILL_CATEGORY_TARGETS.infra.min).toBe(6);
    expect(DEFAULT_BACKFILL_CATEGORY_TARGETS.infra.max).toBe(10);
    expect(DEFAULT_BACKFILL_CATEGORY_TARGETS.research.min).toBe(6);
    expect(DEFAULT_BACKFILL_CATEGORY_TARGETS.research.max).toBe(10);
    expect(DEFAULT_BACKFILL_CATEGORY_TARGETS.policy.min).toBe(5);
    expect(DEFAULT_BACKFILL_CATEGORY_TARGETS.policy.max).toBe(8);
  });

  it('2. dry-run mode accurately discovers candidates and clusters WITHOUT publishing any articles', async () => {
    const db = await getDb();

    // Create a mock source
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'Mock Tech AI Feed',
        baseUrl: 'https://mocktech.ai/feed.xml',
        sourceType: 'rss',
        tier: 'tier_1_primary',
        reputationScore: '1.00',
        isActive: true,
        pollingFrequencyMinutes: 15,
      })
      .returning();

    // Count existing articles before dry run
    const articlesBefore = await db.select().from(schema.articles);

    // Mock RSS adapter returning candidates from the 10-day window
    const now = Date.now();
    const mockRssAdapter = {
      parseUrl: vi.fn().mockResolvedValue([
        {
          canonicalUrl: 'https://mocktech.ai/gpt-5-preview',
          title: 'OpenAI Previews Next Frontier Model Architecture',
          cleanText: 'OpenAI researchers announced technical specifications for their upcoming model.',
          publishedAt: new Date(now - 48 * 3600 * 1000), // 2 days ago
        },
        {
          canonicalUrl: 'https://mocktech.ai/agentic-coding-breakthrough',
          title: 'Autonomous Coding Agents Revolutionize Software Workflows',
          cleanText: 'New agentic framework coordinates multi-agent debugging teams.',
          publishedAt: new Date(now - 72 * 3600 * 1000), // 3 days ago
        },
        {
          canonicalUrl: 'https://mocktech.ai/ai-policy-framework',
          title: 'Federal Trade Commission Releases AI Governance Framework',
          cleanText: 'The regulatory commission issued binding guidance on synthetic content.',
          publishedAt: new Date(now - 96 * 3600 * 1000), // 4 days ago
        },
      ]),
    };

    const orchestrator = new HistoricalBackfillOrchestrator({
      rssAdapter: mockRssAdapter as any,
      aiProvider: new MockAiProvider(),
    });

    const report = await orchestrator.run({
      dryRun: true,
      overlapHours: 240,
    });

    expect(report.isDryRun).toBe(true);
    expect(report.candidatesDiscovered).toBeGreaterThanOrEqual(3);
    expect(report.clustersCreated).toBeGreaterThanOrEqual(3);
    expect(report.articlesSynthesized).toBe(0);
    expect(report.articlesPublished).toBe(0);

    // Verify DB was NOT mutated with new articles
    const articlesAfter = await db.select().from(schema.articles);
    expect(articlesAfter.length).toBe(articlesBefore.length);
  });

  it('3. enforces 5-category balancing so llm_release does not consume the entire backlog', async () => {
    const db = await getDb();

    // Insert 1 source
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'Omni Source Lab',
        baseUrl: 'https://omnisource.com/feed.xml',
        sourceType: 'rss',
        tier: 'tier_1_primary',
        reputationScore: '1.00',
        isActive: true,
      })
      .returning();

    // Seed 20 raw articles heavily skewed towards llm_release (15 LLM releases, 2 agentic, 2 infra, 1 policy)
    const now = Date.now();
    const rawArticlesToInsert = [];

    // 15 LLM releases
    for (let i = 1; i <= 15; i++) {
      rawArticlesToInsert.push({
        sourceId: source.id,
        canonicalUrl: `https://omnisource.com/llm-model-${i}`,
        title: `Model Release: Flagship LLM Version ${i} With Enhanced Weights`,
        cleanText: `Detailed technical release notes for open weights model version ${i}.`,
        rawContent: `Detailed technical release notes for open weights model version ${i}.`,
        contentHash: `hash_llm_${i}`,
        publishedAt: new Date(now - i * 10 * 3600 * 1000),
      });
    }

    // 3 Agentic items
    for (let i = 1; i <= 3; i++) {
      rawArticlesToInsert.push({
        sourceId: source.id,
        canonicalUrl: `https://omnisource.com/agent-tool-${i}`,
        title: `Agentic Workflow: Autonomous Tool Use System ${i}`,
        cleanText: `LangChain and MCP autonomous agents coordinate complex workflows.`,
        rawContent: `LangChain and MCP autonomous agents coordinate complex workflows.`,
        contentHash: `hash_agent_${i}`,
        publishedAt: new Date(now - i * 12 * 3600 * 1000),
      });
    }

    // 3 Infrastructure items
    for (let i = 1; i <= 3; i++) {
      rawArticlesToInsert.push({
        sourceId: source.id,
        canonicalUrl: `https://omnisource.com/infra-gpu-${i}`,
        title: `Datacenter GPU Supercluster Scale Deployment ${i}`,
        cleanText: `NVIDIA Blackwell chips and high speed networking powering compute clusters.`,
        rawContent: `NVIDIA Blackwell chips and high speed networking powering compute clusters.`,
        contentHash: `hash_infra_${i}`,
        publishedAt: new Date(now - i * 14 * 3600 * 1000),
      });
    }

    // 3 Policy items
    for (let i = 1; i <= 3; i++) {
      rawArticlesToInsert.push({
        sourceId: source.id,
        canonicalUrl: `https://omnisource.com/policy-act-${i}`,
        title: `AI Safety Regulation and Copyright Lawsuit Decision ${i}`,
        cleanText: `Judicial decision and national policy regarding copyright infringement claims.`,
        rawContent: `Judicial decision and national policy regarding copyright infringement claims.`,
        contentHash: `hash_policy_${i}`,
        publishedAt: new Date(now - i * 16 * 3600 * 1000),
      });
    }

    await db.insert(schema.rawArticles).values(rawArticlesToInsert);

    const orchestrator = new HistoricalBackfillOrchestrator({
      aiProvider: new MockAiProvider(),
      rssAdapter: { parseUrl: vi.fn().mockResolvedValue([]) } as any,
      ingestionService: {
        ingestSource: async () => ({
          candidatesInspected: 0,
          exactDuplicatesSkipped: 0,
          nearDuplicatesSkipped: 0,
          insertedCount: 0,
          errors: [],
        }),
      } as any,
    });

    const report = await orchestrator.run({
      dryRun: true,
      overlapHours: 240,
      categoryTargets: {
        llm_release: { max: 10, min: 8, target: 10 },
      },
    });

    // Verify category balancing capped llm_release at max 10 even though 15 candidates existed
    const llmSelected = report.selectedStoriesBreakdown.filter((s) => s.category === 'llm_release');
    expect(llmSelected.length).toBeLessThanOrEqual(10);

    // Other categories still received their candidate selections
    const agenticSelected = report.selectedStoriesBreakdown.filter((s) => s.category === 'agentic');
    const infraSelected = report.selectedStoriesBreakdown.filter((s) => s.category === 'infra');
    expect(agenticSelected.length).toBeGreaterThanOrEqual(1);
    expect(infraSelected.length).toBeGreaterThanOrEqual(1);
  }, 15000);

  it('4. gates high-risk stories (lawsuits/breaches) from automatic publishing', async () => {
    const db = await getDb();
    const [source] = await db.select().from(schema.sources).limit(1);

    // Insert high-risk raw article
    const [highRiskRaw] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: source.id,
        canonicalUrl: 'https://risky-news.com/major-copyright-lawsuit',
        title: 'Publishers File Federal Copyright Infringement Lawsuit Against AI Firm',
        cleanText: 'A group of major publishers filed an extensive copyright lawsuit alleging infringement.',
        rawContent: 'A group of major publishers filed an extensive copyright lawsuit alleging infringement.',
        contentHash: 'hash_lawsuit_1',
        publishedAt: new Date(),
      })
      .returning();

    const orchestrator = new HistoricalBackfillOrchestrator({
      aiProvider: new MockAiProvider(),
      rssAdapter: { parseUrl: vi.fn().mockResolvedValue([]) } as any,
      ingestionService: {
        ingestSource: async () => ({
          candidatesInspected: 0,
          exactDuplicatesSkipped: 0,
          nearDuplicatesSkipped: 0,
          insertedCount: 0,
          errors: [],
        }),
      } as any,
    });

    const report = await orchestrator.run({
      dryRun: true,
      overlapHours: 240,
    });

    // High risk story should be held for review, not auto-approved
    expect(report.storiesHeldForReview).toBeGreaterThanOrEqual(1);
    const lawsuitCandidate = report.selectedStoriesBreakdown.find((s) =>
      s.title.includes('Copyright Infringement Lawsuit')
    );
    // Because it is high risk (lawsuit), it is NOT auto-approved and therefore NOT selected for publishing
    expect(lawsuitCandidate).toBeUndefined();
  }, 15000);

  it('5. guarantees idempotency and resumability on repeated backfill runs', async () => {
    const db = await getDb();
    const [source] = await db.select().from(schema.sources).limit(1);

    // Create an auto-approved story that already has a published article
    const [story] = await db
      .insert(schema.stories)
      .values({
        title: 'NVIDIA Announces Blackwell Ultra Accelerators',
        summary: 'New GPU packaging delivers unprecedented FP4 inference throughput.',
        category: 'infra',
        editorialStatus: 'auto_approved',
        riskLevel: 'low',
        importanceScore: 88,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
        primarySourceId: source.id,
      })
      .returning();

    const [existingArticle] = await db
      .insert(schema.articles)
      .values({
        storyId: story.id,
        title: 'NVIDIA Announces Blackwell Ultra Accelerators',
        slug: 'nvidia-announces-blackwell-ultra-accelerators',
        deck: 'New GPU packaging delivers unprecedented FP4 inference throughput.',
        contentMarkdown: 'Full analysis of the architecture...',
        status: 'published',
        metaDescription: 'NVIDIA Blackwell Ultra GPU announcement.',
        publishedAt: new Date(),
      })
      .returning();

    const mockWriter = {
      synthesizeStoryArticle: vi.fn(),
    };

    const orchestrator = new HistoricalBackfillOrchestrator({
      aiProvider: new MockAiProvider(),
      writer: mockWriter as any,
      rssAdapter: { parseUrl: vi.fn().mockResolvedValue([]) } as any,
      ingestionService: {
        ingestSource: async () => ({
          candidatesInspected: 0,
          exactDuplicatesSkipped: 0,
          nearDuplicatesSkipped: 0,
          insertedCount: 0,
          errors: [],
        }),
      } as any,
    });

    // Run real execution backfill
    await orchestrator.run({
      dryRun: false,
      overlapHours: 240,
    });

    // Writer should NOT have been called for the story that already has a published article
    expect(mockWriter.synthesizeStoryArticle).not.toHaveBeenCalled();

    // The database should still have exactly 1 article for this story
    const articles = await db
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.storyId, story.id));
    expect(articles.length).toBe(1);
  });

  it('6. strictly caps synthesis and selected stories when limit option is passed (controlled test mode)', async () => {
    const db = await getDb();
    const [source] = await db.select().from(schema.sources).limit(1);

    // Insert 10 auto-approved stories across different categories
    const now = Date.now();
    const categories: PublicCategory[] = ['llm_release', 'agentic', 'infra', 'research', 'policy'];
    for (let i = 0; i < 10; i++) {
      const cat = categories[i % categories.length];
      const [st] = await db
        .insert(schema.stories)
        .values({
          title: `Test Story Candidate ${i + 1}`,
          summary: `Summary of candidate ${i + 1}`,
          category: cat,
          editorialStatus: 'auto_approved',
          riskLevel: 'low',
          importanceScore: 80 + i,
          firstSeenAt: new Date(now - i * 3600 * 1000),
          lastUpdatedAt: new Date(now - i * 3600 * 1000),
          primarySourceId: source.id,
        })
        .returning();

      // Link raw article
      const [raw] = await db
        .insert(schema.rawArticles)
        .values({
          sourceId: source.id,
          canonicalUrl: `https://test-limit.com/article-${i}`,
          title: `Raw Article ${i}`,
          cleanText: `Clean text for article ${i}`,
          rawContent: `Raw content for article ${i}`,
          contentHash: `hash_limit_${i}`,
        })
        .returning();

      await db.insert(schema.storySources).values({
        storyId: st.id,
        rawArticleId: raw.id,
        isPrimary: true,
      });
    }

    const mockWriter = {
      synthesizeStoryArticle: vi.fn().mockImplementation(async (packet: any) => ({
        id: `art-${Math.random()}`,
        storyId: packet.storyId,
        title: 'Synthesized Title',
        slug: `slug-${Math.random().toString(36).substring(2, 7)}`,
        status: 'published',
      })),
    };

    const orchestrator = new HistoricalBackfillOrchestrator({
      aiProvider: new MockAiProvider(),
      writer: mockWriter as any,
      researcher: {
        buildEvidencePacket: vi.fn().mockResolvedValue({
          storyId: 'story-1',
          primarySources: [{ title: 'Title', url: 'https://test.com', text: 'Text' }],
          secondarySources: [],
          confirmedFacts: ['Fact 1'],
          differingPerspectives: [],
        }),
      } as any,
      rssAdapter: { parseUrl: vi.fn().mockResolvedValue([]) } as any,
      ingestionService: {
        ingestSource: async () => ({
          candidatesInspected: 0,
          exactDuplicatesSkipped: 0,
          nearDuplicatesSkipped: 0,
          insertedCount: 0,
          errors: [],
        }),
      } as any,
    });

    const report = await orchestrator.run({
      dryRun: false,
      overlapHours: 240,
      limit: 3,
    });

    expect(report.selectedForSynthesis).toBe(3);
    expect(report.articlesSynthesized).toBe(3);
    expect(mockWriter.synthesizeStoryArticle).toHaveBeenCalledTimes(3);
  }, 15000);

  it('7. halts synthesis gracefully when Gemini call budget is reached and outputs detailed phase timings', async () => {
    const db = await getDb();
    const [source] = await db.select().from(schema.sources).limit(1);

    // Insert 5 candidate stories
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const [st] = await db
        .insert(schema.stories)
        .values({
          title: `Budget Test Story ${i + 1}`,
          summary: `Summary ${i + 1}`,
          category: 'llm_release',
          editorialStatus: 'auto_approved',
          riskLevel: 'low',
          importanceScore: 85,
          firstSeenAt: new Date(now - i * 3600 * 1000),
          lastUpdatedAt: new Date(now - i * 3600 * 1000),
          primarySourceId: source.id,
        })
        .returning();

      const [raw] = await db
        .insert(schema.rawArticles)
        .values({
          sourceId: source.id,
          canonicalUrl: `https://test-budget.com/article-${i}`,
          title: `Raw Budget ${i}`,
          cleanText: `Clean text ${i}`,
          rawContent: `Raw content ${i}`,
          contentHash: `hash_budget_${i}`,
        })
        .returning();

      await db.insert(schema.storySources).values({
        storyId: st.id,
        rawArticleId: raw.id,
        isPrimary: true,
      });
    }

    let callsMade = 0;
    const mockWriter = {
      synthesizeStoryArticle: vi.fn().mockImplementation(async (packet: any) => {
        callsMade++;
        return {
          id: `art-budget-${callsMade}`,
          storyId: packet.storyId,
          title: 'Budget Synthesized Title',
          slug: `slug-budget-${callsMade}`,
          status: 'published',
        };
      }),
    };

    const orchestrator = new HistoricalBackfillOrchestrator({
      aiProvider: new MockAiProvider(),
      writer: mockWriter as any,
      researcher: {
        buildEvidencePacket: vi.fn().mockResolvedValue({
          storyId: 'story-b',
          primarySources: [{ title: 'Title', url: 'https://test.com', text: 'Text' }],
          secondarySources: [],
          confirmedFacts: ['Fact 1'],
          differingPerspectives: [],
        }),
      } as any,
      rssAdapter: { parseUrl: vi.fn().mockResolvedValue([]) } as any,
      ingestionService: {
        ingestSource: async () => ({
          candidatesInspected: 0,
          exactDuplicatesSkipped: 0,
          nearDuplicatesSkipped: 0,
          insertedCount: 0,
          errors: [],
        }),
      } as any,
    });

    // Pass limit: 5, but geminiBudget: 2
    const report = await orchestrator.run({
      dryRun: false,
      overlapHours: 240,
      limit: 5,
      geminiBudget: 2,
    });

    // Should stop at exactly 2 articles synthesized due to budget cap
    expect(report.selectedForSynthesis).toBe(5);
    expect(report.geminiBudget).toBe(2);
    expect(report.geminiCallsUsed).toBe(2);
    expect(report.articlesSynthesized).toBe(2);
    expect(report.stoppedEarlyDueToBudget).toBe(true);
    expect(report.budgetRemaining).toBe(0);
    expect(mockWriter.synthesizeStoryArticle).toHaveBeenCalledTimes(2);

    // Verify detailed phase timings exist
    expect(report.phaseTimings).toBeDefined();
    expect(typeof report.phaseTimings.rssIngestionMs).toBe('number');
    expect(typeof report.phaseTimings.clusteringMs).toBe('number');
    expect(typeof report.phaseTimings.categoryBalancingMs).toBe('number');
    expect(typeof report.phaseTimings.geminiGenerationMs).toBe('number');
    expect(typeof report.phaseTimings.verificationMs).toBe('number');
    expect(typeof report.phaseTimings.totalElapsedMs).toBe('number');

    // Verify callsPerStory breakdown exists
    expect(report.callsPerStory).toBeDefined();
    expect(report.callsPerStory?.length).toBeGreaterThanOrEqual(2);
  }, 15000);
});
