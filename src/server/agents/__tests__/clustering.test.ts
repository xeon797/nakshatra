import { describe, it, expect, beforeAll } from 'vitest';
import {
  HybridStoryClusteringAgent,
  RawArticleForClustering,
  checkHeuristicMatch,
  hasHighRiskKeywords,
  determineEditorialStatus,
} from '../clusterer';
import { MockAiProvider } from '../../../services/ai/mock-provider';
import { getDb, resetDbForTesting } from '../../../db';
import { initializeDatabase } from '../../../db/init';
import * as schema from '../../../db/schema';
import { eq } from 'drizzle-orm';

describe('Module 5: Clustering Tests (clustering.test.ts)', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1: Lexical pre-filter correctly groups identical headlines from different outlets
  // ─────────────────────────────────────────────────────────────────────────
  it('Test 1: Lexical pre-filter correctly groups identical headlines from different outlets', () => {
    const now = new Date();

    const outletA: RawArticleForClustering = {
      id: 'art-outlet-a',
      sourceId: 'src-a',
      sourceName: 'TechCrunch AI',
      sourceTier: 'tier_3_aggregator',
      title: 'Meta releases Llama 3.3 open weights model',
      cleanText: 'Meta has rolled out Llama 3.3 with 70B parameters.',
      summaryExcerpt: 'Meta releases Llama 3.3 open weights model.',
      publishedAt: now,
      createdAt: now,
      canonicalUrl: 'https://techcrunch.com/llama-3-3',
    };

    const outletB: RawArticleForClustering = {
      id: 'art-outlet-b',
      sourceId: 'src-b',
      sourceName: 'The Verge AI',
      sourceTier: 'tier_3_aggregator',
      title: 'Meta releases Llama 3.3 open weights model for developers',
      cleanText: 'Meta announces Llama 3.3 open weights model today.',
      summaryExcerpt: 'Meta releases Llama 3.3 open weights model.',
      publishedAt: now,
      createdAt: now,
      canonicalUrl: 'https://theverge.com/llama-3-3',
    };

    const isMatch = checkHeuristicMatch(outletA, outletB);
    expect(isMatch).toBe(true);

    const agent = new HybridStoryClusteringAgent();
    const groups = agent.groupCandidatesIntoClusters([outletA, outletB]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
    expect(groups[0].map((a) => a.id)).toContain('art-outlet-a');
    expect(groups[0].map((a) => a.id)).toContain('art-outlet-b');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2: Diverse feeds on the same day are split into separate clusters
  // ─────────────────────────────────────────────────────────────────────────
  it('Test 2: Diverse feeds on the same day (arXiv paper vs hardware launch) are split into separate clusters', () => {
    const today = new Date();

    const arxivPaper: RawArticleForClustering = {
      id: 'art-arxiv',
      sourceId: 'src-arxiv',
      sourceName: 'arXiv cs.AI',
      sourceTier: 'tier_2_verified',
      title: 'Provable Convergence Bounds for Diffusion Policy Optimization in Continuous Control',
      cleanText: 'We prove finite-time convergence guarantees for diffusion models.',
      summaryExcerpt: 'Theoretical analysis of diffusion policy reinforcement learning.',
      publishedAt: today,
      createdAt: today,
      canonicalUrl: 'https://arxiv.org/abs/2609.12345',
    };

    const hardwareLaunch: RawArticleForClustering = {
      id: 'art-nvidia',
      sourceId: 'src-nvidia',
      sourceName: 'NVIDIA Newsroom',
      sourceTier: 'tier_1_primary',
      title: 'NVIDIA Blackwell Ultra GPUs Enter Full Commercial Production',
      cleanText: 'NVIDIA announces full scale volume production of Blackwell Ultra architecture.',
      summaryExcerpt: 'Blackwell Ultra GPUs entering data centers worldwide.',
      publishedAt: today,
      createdAt: today,
      canonicalUrl: 'https://nvidianews.nvidia.com/blackwell-ultra',
    };

    const isMatch = checkHeuristicMatch(arxivPaper, hardwareLaunch);
    expect(isMatch).toBe(false);

    const agent = new HybridStoryClusteringAgent();
    const groups = agent.groupCandidatesIntoClusters([arxivPaper, hardwareLaunch]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(1);
    expect(groups[1]).toHaveLength(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3: Multiple sources link to a single story_id in story_sources with exact primary source selection
  // ─────────────────────────────────────────────────────────────────────────
  it('Test 3: Multiple sources link to a single story_id in story_sources with exact primary source selection', async () => {
    const db = await getDb();

    // 1. Create primary lab source and journalism source
    const [deepMindSource] = await db
      .insert(schema.sources)
      .values({
        name: 'Google DeepMind Research',
        baseUrl: 'https://deepmind.google/feed-test-t3.xml',
        sourceType: 'rss',
        tier: 'tier_1_primary',
        reputationScore: '1.00',
      })
      .returning();

    const [vergeSource] = await db
      .insert(schema.sources)
      .values({
        name: 'The Verge AI',
        baseUrl: 'https://theverge.com/feed-test-t3.xml',
        sourceType: 'rss',
        tier: 'tier_3_aggregator',
        reputationScore: '0.70',
      })
      .returning();

    // 2. Insert raw articles
    const [rawPrimary] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: deepMindSource.id,
        canonicalUrl: 'https://deepmind.google/alphafold-3-release-notes',
        title: 'AlphaFold 3 Predicts Structure of Life',
        cleanText: 'Google DeepMind releases AlphaFold 3 with biomolecular interaction modelling.',
        rawContent: 'Google DeepMind releases AlphaFold 3 with biomolecular interaction modelling.',
        contentHash: 'hash_test3_primary',
      })
      .returning();

    const [rawSecondary] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: vergeSource.id,
        canonicalUrl: 'https://theverge.com/alphafold-3-deepmind-science',
        title: 'DeepMind AlphaFold 3 takes biology beyond proteins',
        cleanText: 'The Verge covers DeepMind release of AlphaFold 3.',
        rawContent: 'The Verge covers DeepMind release of AlphaFold 3.',
        contentHash: 'hash_test3_secondary',
      })
      .returning();

    // 3. Mock LLM confirms cluster and designates index 0 (DeepMind) as primary source
    const mockProvider = new MockAiProvider({
      mockStructured: {
        isSameStory: true,
        matchingArticleIndices: [0, 1],
        primaryArticleIndex: 0,
        canonicalTitle: 'Google DeepMind Releases AlphaFold 3 for Biomolecular Modelling',
        summary: 'DeepMind has released AlphaFold 3, expanding predictive biology to all life molecules.',
        category: 'research',
        riskLevel: 'low',
        importanceScore: 98,
        reasoning: 'Primary lab announcement corroborated by technology press coverage.',
      },
    });

    const agent = new HybridStoryClusteringAgent(mockProvider);
    const clusterResult = await agent.verifyAndSynthesizeCluster([
      {
        id: rawPrimary.id,
        sourceId: deepMindSource.id,
        sourceName: deepMindSource.name,
        sourceTier: 'tier_1_primary',
        title: rawPrimary.title,
        cleanText: rawPrimary.cleanText,
        summaryExcerpt: rawPrimary.summaryExcerpt,
        publishedAt: rawPrimary.publishedAt,
        createdAt: rawPrimary.createdAt,
        canonicalUrl: rawPrimary.canonicalUrl,
      },
      {
        id: rawSecondary.id,
        sourceId: vergeSource.id,
        sourceName: vergeSource.name,
        sourceTier: 'tier_3_aggregator',
        title: rawSecondary.title,
        cleanText: rawSecondary.cleanText,
        summaryExcerpt: rawSecondary.summaryExcerpt,
        publishedAt: rawSecondary.publishedAt,
        createdAt: rawSecondary.createdAt,
        canonicalUrl: rawSecondary.canonicalUrl,
      },
    ]);

    expect(clusterResult).not.toBeNull();
    expect(clusterResult!.story.primarySourceId).toBe(deepMindSource.id);

    // Verify junction rows in story_sources
    const storySourcesLinks = await db
      .select()
      .from(schema.storySources)
      .where(eq(schema.storySources.storyId, clusterResult!.story.id));

    expect(storySourcesLinks).toHaveLength(2);

    const primaryLink = storySourcesLinks.find((s) => s.rawArticleId === rawPrimary.id);
    const secondaryLink = storySourcesLinks.find((s) => s.rawArticleId === rawSecondary.id);

    expect(primaryLink).toBeDefined();
    expect(primaryLink!.isPrimary).toBe(true);

    expect(secondaryLink).toBeDefined();
    expect(secondaryLink!.isPrimary).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4: Verify risk categorization assigns needs_review to high-risk keywords
  // ─────────────────────────────────────────────────────────────────────────
  it('Test 4: Verify risk categorization assigns needs_review to high-risk keywords (lawsuit, vulnerability, leak)', async () => {
    // 1. Check keyword detection function directly
    expect(hasHighRiskKeywords('Major copyright lawsuit filed against AI training data')).toBe(true);
    expect(hasHighRiskKeywords('Critical vulnerability discovered in MCP server implementation')).toBe(true);
    expect(hasHighRiskKeywords('Internal weights leak reveals proprietary safety evals')).toBe(true);
    expect(hasHighRiskKeywords('Anthropic releases updated developer SDK for Python')).toBe(false);

    // 2. Test editorial status triage for high risk
    expect(determineEditorialStatus('high', 99)).toBe('needs_review');
    expect(determineEditorialStatus('high', 10)).toBe('needs_review');

    // 3. End-to-end agent synthesis: even if mock LLM says 'low', presence of 'lawsuit' keyword enforces 'high' & 'needs_review'
    const db = await getDb();
    const [source] = await db.select().from(schema.sources).limit(1);

    const [lawsuitArticle] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: source.id,
        canonicalUrl: 'https://example.com/ai-copyright-lawsuit',
        title: 'Publishers file federal copyright lawsuit against frontier lab',
        cleanText: 'A group of major publishers has filed a copyright lawsuit alleging unlicensed training.',
        rawContent: 'A group of major publishers has filed a copyright lawsuit alleging unlicensed training.',
        contentHash: 'hash_test4_lawsuit',
      })
      .returning();

    const mockProvider = new MockAiProvider({
      mockStructured: {
        isSameStory: true,
        matchingArticleIndices: [0],
        primaryArticleIndex: 0,
        canonicalTitle: 'Publishers File Federal Copyright Lawsuit Against Frontier Lab',
        summary: 'Lawsuit alleges copyright infringement in pre-training data scraping.',
        category: 'policy',
        riskLevel: 'low', // Mock attempts low, but keyword detector will elevate to 'high'
        importanceScore: 88,
        reasoning: 'Legal dispute regarding training data.',
      },
    });

    const agent = new HybridStoryClusteringAgent(mockProvider);
    const result = await agent.verifyAndSynthesizeCluster([
      {
        id: lawsuitArticle.id,
        sourceId: source.id,
        sourceName: source.name,
        sourceTier: source.tier as any,
        title: lawsuitArticle.title,
        cleanText: lawsuitArticle.cleanText,
        summaryExcerpt: lawsuitArticle.summaryExcerpt,
        publishedAt: lawsuitArticle.publishedAt,
        createdAt: lawsuitArticle.createdAt,
        canonicalUrl: lawsuitArticle.canonicalUrl,
      },
    ]);

    expect(result).not.toBeNull();
    // High risk keyword "lawsuit" enforces riskLevel = 'high' and editorialStatus = 'needs_review'
    expect(result!.story.riskLevel).toBe('high');
    expect(result!.story.editorialStatus).toBe('needs_review');
  });
});
