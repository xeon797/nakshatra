import { describe, it, expect, beforeAll } from 'vitest';
import {
  HybridStoryClusteringAgent,
  normalizeTitle,
  calculateJaccardSimilarity,
  extractEntities,
  checkHeuristicMatch,
  determineEditorialStatus,
  RawArticleForClustering,
} from '../clusterer';
import { MockAiProvider } from '../../../services/ai/mock-provider';
import { getDb, resetDbForTesting } from '../../../db';
import { initializeDatabase } from '../../../db/init';
import * as schema from '../../../db/schema';
import { eq } from 'drizzle-orm';

describe('Module 2 & 3: Hybrid Story Clustering Agent & Editorial Gatekeeping', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  describe('Phase A: Fast Lexical Heuristics', () => {
    it('normalizes titles by stripping punctuation and stop words', () => {
      const tokens = normalizeTitle('Anthropic has announced Claude 3.7 Sonnet with hybrid reasoning!');
      expect(tokens).toContain('anthropic');
      expect(tokens).toContain('announced');
      expect(tokens).toContain('claude');
      expect(tokens).toContain('3-7'); // or numeric token
      expect(tokens).toContain('sonnet');
      expect(tokens).toContain('hybrid');
      expect(tokens).toContain('reasoning');
      expect(tokens).not.toContain('has');
      expect(tokens).not.toContain('with');
    });

    it('calculates Jaccard similarity correctly and detects high overlap (> 0.45)', () => {
      const title1 = normalizeTitle('OpenAI releases GPT-4.5 with advanced reasoning capabilities');
      const title2 = normalizeTitle('OpenAI announces GPT-4.5 with advanced reasoning models');

      const similarity = calculateJaccardSimilarity(title1, title2);
      expect(similarity).toBeGreaterThan(0.45);

      const title3 = normalizeTitle('NVIDIA reports record quarterly revenue driven by AI GPU demand');
      const dissimilar = calculateJaccardSimilarity(title1, title3);
      expect(dissimilar).toBeLessThan(0.15);
    });

    it('extracts known AI entities from text', () => {
      const entities = extractEntities('DeepSeek-R1 open weights release disrupts OpenAI and Anthropic Claude 3.7');
      expect(entities.has('deepseek-r1')).toBe(true);
      expect(entities.has('openai')).toBe(true);
      expect(entities.has('anthropic')).toBe(true);
      expect(entities.has('claude 3.7')).toBe(true);
    });

    it('matches articles within 6 hours of a primary lab announcement sharing entity', () => {
      const now = new Date();
      const articlePrimary: RawArticleForClustering = {
        id: 'primary-1',
        sourceId: 'src-1',
        sourceName: 'Anthropic Official Blog',
        sourceTier: 'tier_1_primary',
        title: 'Introducing Claude 3.7 Sonnet',
        cleanText: 'Anthropic announces Claude 3.7 Sonnet.',
        summaryExcerpt: 'Anthropic announces Claude 3.7 Sonnet.',
        publishedAt: now,
        createdAt: now,
        canonicalUrl: 'https://anthropic.com/claude-3-7',
      };

      const articleTechNews: RawArticleForClustering = {
        id: 'news-1',
        sourceId: 'src-2',
        sourceName: 'The Verge AI',
        sourceTier: 'tier_3_aggregator',
        title: 'Claude 3.7 brings hybrid reasoning to developers',
        cleanText: 'The Verge reports on Claude 3.7.',
        summaryExcerpt: 'The Verge reports on Claude 3.7.',
        publishedAt: new Date(now.getTime() + 2 * 60 * 60 * 1000), // 2 hours later (<= 6h)
        createdAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
        canonicalUrl: 'https://theverge.com/claude-3-7',
      };

      const matches = checkHeuristicMatch(articlePrimary, articleTechNews);
      expect(matches).toBe(true);
    });
  });

  describe('Module 3: Editorial Risk Classification Triage', () => {
    it('auto-approves low risk stories', () => {
      expect(determineEditorialStatus('low', 80)).toBe('auto_approved');
      expect(determineEditorialStatus('low', 95)).toBe('auto_approved');
    });

    it('flags medium risk stories for review', () => {
      expect(determineEditorialStatus('medium', 85)).toBe('needs_review');
      expect(determineEditorialStatus('medium', 60)).toBe('needs_review');
    });

    it('strictly requires human review for high risk stories regardless of score', () => {
      expect(determineEditorialStatus('high', 99)).toBe('needs_review');
      expect(determineEditorialStatus('high', 40)).toBe('needs_review');
    });
  });

  describe('Phase B: LLM Semantic Verification & Multi-Source Story Synthesis', () => {
    it('clusters multi-source articles, assigns primary source, and creates story_sources links', async () => {
      const db = await getDb();

      // Create sources
      const [primarySource] = await db
        .insert(schema.sources)
        .values({
          name: 'OpenAI Newsroom',
          baseUrl: 'https://openai.com/test-cluster-feed',
          sourceType: 'rss',
          tier: 'tier_1_primary',
          reputationScore: '1.00',
        })
        .returning();

      const [journalismSource] = await db
        .insert(schema.sources)
        .values({
          name: 'TechCrunch AI',
          baseUrl: 'https://techcrunch.com/test-cluster-feed',
          sourceType: 'rss',
          tier: 'tier_3_aggregator',
          reputationScore: '0.70',
        })
        .returning();

      // Insert 2 raw articles covering the same GPT-4.5 launch
      const [rawArticle1] = await db
        .insert(schema.rawArticles)
        .values({
          sourceId: primarySource.id,
          canonicalUrl: 'https://openai.com/index/gpt-4-5-official',
          title: 'Introducing GPT-4.5',
          cleanText: 'OpenAI announces GPT-4.5 with broad capability improvements across coding and math.',
          rawContent: 'OpenAI announces GPT-4.5 with broad capability improvements across coding and math.',
          contentHash: 'hash_cluster_test_1',
          createdAt: new Date(),
        })
        .returning();

      const [rawArticle2] = await db
        .insert(schema.rawArticles)
        .values({
          sourceId: journalismSource.id,
          canonicalUrl: 'https://techcrunch.com/openai-launches-gpt-4-5',
          title: 'OpenAI officially rolls out GPT-4.5 for developers',
          cleanText: 'TechCrunch reports on OpenAI launching its newest flagship model GPT-4.5 today.',
          rawContent: 'TechCrunch reports on OpenAI launching its newest flagship model GPT-4.5 today.',
          contentHash: 'hash_cluster_test_2',
          createdAt: new Date(),
        })
        .returning();

      // Mock LLM confirms cluster
      const mockProvider = new MockAiProvider({
        mockStructured: {
          isSameStory: true,
          matchingArticleIndices: [0, 1],
          primaryArticleIndex: 0,
          canonicalTitle: 'OpenAI Unveils Flagship GPT-4.5 with Advanced Steerability',
          summary: 'OpenAI has officially launched GPT-4.5, delivering significant benchmark lifts in coding and reasoning. Coverage from tech press corroborates immediate API availability.',
          category: 'llm_release',
          riskLevel: 'low',
          importanceScore: 94,
          reasoning: 'Both articles cover the official announcement and rollout of OpenAI GPT-4.5. Low risk official product documentation.',
        },
      });

      const agent = new HybridStoryClusteringAgent(mockProvider);

      const unclustered = await agent.fetchUnclusteredArticles(36);
      expect(unclustered.some((a) => a.id === rawArticle1.id)).toBe(true);
      expect(unclustered.some((a) => a.id === rawArticle2.id)).toBe(true);

      const clusterResult = await agent.verifyAndSynthesizeCluster([
        {
          id: rawArticle1.id,
          sourceId: primarySource.id,
          sourceName: primarySource.name,
          sourceTier: 'tier_1_primary',
          title: rawArticle1.title,
          cleanText: rawArticle1.cleanText,
          summaryExcerpt: rawArticle1.summaryExcerpt,
          publishedAt: rawArticle1.publishedAt,
          createdAt: rawArticle1.createdAt,
          canonicalUrl: rawArticle1.canonicalUrl,
        },
        {
          id: rawArticle2.id,
          sourceId: journalismSource.id,
          sourceName: journalismSource.name,
          sourceTier: 'tier_3_aggregator',
          title: rawArticle2.title,
          cleanText: rawArticle2.cleanText,
          summaryExcerpt: rawArticle2.summaryExcerpt,
          publishedAt: rawArticle2.publishedAt,
          createdAt: rawArticle2.createdAt,
          canonicalUrl: rawArticle2.canonicalUrl,
        },
      ]);

      expect(clusterResult).not.toBeNull();
      expect(clusterResult!.story.title).toContain('OpenAI Unveils Flagship GPT-4.5');
      expect(clusterResult!.story.category).toBe('llm_release');
      expect(clusterResult!.story.editorialStatus).toBe('auto_approved');
      expect(clusterResult!.story.riskLevel).toBe('low');
      expect(clusterResult!.story.primarySourceId).toBe(primarySource.id);

      // Verify story_sources junction rows
      const linked = await db
        .select()
        .from(schema.storySources)
        .where(eq(schema.storySources.storyId, clusterResult!.story.id));

      expect(linked).toHaveLength(2);
      const primaryLink = linked.find((l) => l.rawArticleId === rawArticle1.id);
      const secondaryLink = linked.find((l) => l.rawArticleId === rawArticle2.id);
      expect(primaryLink?.isPrimary).toBe(true);
      expect(secondaryLink?.isPrimary).toBe(false);

      // Verify that candidate window now excludes these clustered articles
      const remainingUnclustered = await agent.fetchUnclusteredArticles(36);
      expect(remainingUnclustered.some((a) => a.id === rawArticle1.id)).toBe(false);
      expect(remainingUnclustered.some((a) => a.id === rawArticle2.id)).toBe(false);
    });

    it('rejects clustering when LLM determines articles are different events', async () => {
      const mockProvider = new MockAiProvider({
        mockStructured: {
          isSameStory: false,
          matchingArticleIndices: [0],
          primaryArticleIndex: 0,
          canonicalTitle: 'Irrelevant',
          summary: 'Irrelevant',
          category: 'research',
          riskLevel: 'medium',
          importanceScore: 50,
          reasoning: 'Articles describe two distinct announcements.',
        },
      });

      const agent = new HybridStoryClusteringAgent(mockProvider);
      const result = await agent.verifyAndSynthesizeCluster([
        {
          id: 'test-diff-1',
          sourceId: 'src-1',
          sourceName: 'Lab A',
          sourceTier: 'tier_1_primary',
          title: 'Quantum computing error correction milestone',
          cleanText: 'Text A',
          summaryExcerpt: 'Excerpt A',
          publishedAt: new Date(),
          createdAt: new Date(),
          canonicalUrl: 'https://example.com/quantum',
        },
        {
          id: 'test-diff-2',
          sourceId: 'src-2',
          sourceName: 'Lab B',
          sourceTier: 'tier_2_verified',
          title: 'Autonomous driving agent policy update',
          cleanText: 'Text B',
          summaryExcerpt: 'Excerpt B',
          publishedAt: new Date(),
          createdAt: new Date(),
          canonicalUrl: 'https://example.com/driving',
        },
      ]);

      expect(result).toBeNull();
    });
  });
});
