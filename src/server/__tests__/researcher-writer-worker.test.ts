import { describe, it, expect, beforeAll, vi } from 'vitest';
import { MultiSourceResearcherAgent } from '../agents/researcher';
import { MultiSourceWriterAgent } from '../agents/writer';
import { AutonomousPhase2Worker } from '../worker';
import { MockAiProvider } from '../../services/ai/mock-provider';
import { getDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';

describe('Module 4 & 5: Multi-Source Researcher, Writer & Phase 2 Worker', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  it('Module 4: aggregates multi-source EvidencePacket and synthesizes article', async () => {
    const db = await getDb();

    // 1. Create primary and secondary sources
    const [primarySource] = await db
      .insert(schema.sources)
      .values({
        name: 'OpenAI Newsroom',
        baseUrl: 'https://openai.com/test-packet-rss.xml',
        sourceType: 'rss',
        tier: 'tier_1_primary',
      })
      .returning();

    const [secondarySource] = await db
      .insert(schema.sources)
      .values({
        name: 'TechCrunch AI',
        baseUrl: 'https://techcrunch.com/test-packet-rss.xml',
        sourceType: 'rss',
        tier: 'tier_3_aggregator',
      })
      .returning();

    // 2. Create Story
    const [story] = await db
      .insert(schema.stories)
      .values({
        title: 'OpenAI Introduces Operator Autonomous Agent',
        summary: 'OpenAI has released Operator, an autonomous browser and desktop agent.',
        category: 'agentic',
        editorialStatus: 'auto_approved',
        riskLevel: 'low',
        importanceScore: 95,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
        primarySourceId: primarySource.id,
      })
      .returning();

    // 3. Create raw articles
    const [rawPrimary] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: primarySource.id,
        canonicalUrl: 'https://openai.com/blog/operator-launch',
        title: 'Introducing Operator',
        cleanText: 'OpenAI announces Operator, a research preview of an autonomous agent that can execute tasks in web browsers.',
        rawContent: 'OpenAI announces Operator.',
        contentHash: 'hash_packet_raw1',
      })
      .returning();

    const [rawSecondary] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: secondarySource.id,
        canonicalUrl: 'https://techcrunch.com/openai-operator-autonomous-agent',
        title: 'OpenAI debuts Operator agent for browser automation',
        cleanText: 'TechCrunch analysis: Operator enters competitive arena against Anthropic computer use.',
        rawContent: 'TechCrunch analysis.',
        contentHash: 'hash_packet_raw2',
      })
      .returning();

    // Link raw articles in story_sources
    await db.insert(schema.storySources).values([
      {
        storyId: story.id,
        rawArticleId: rawPrimary.id,
        isPrimary: true,
      },
      {
        storyId: story.id,
        rawArticleId: rawSecondary.id,
        isPrimary: false,
      },
    ]);

    // Setup Mock AI Provider with sequential responses for Researcher and Writer
    const mockProvider = new MockAiProvider();

    // Extraction 1 (Primary):
    mockProvider.enqueueStructuredResponse({
      claims: [
        {
          claimText: 'OpenAI Operator executes computer tasks directly in web browsers.',
          claimType: 'product_release',
          sourceExcerpt: 'OpenAI announces Operator, a research preview of an autonomous agent that can execute tasks in web browsers.',
          confidenceScore: 0.99,
        },
      ],
    });

    // Extraction 2 (Secondary):
    mockProvider.enqueueStructuredResponse({
      claims: [
        {
          claimText: 'Operator competes directly with Anthropic computer use tools.',
          claimType: 'architecture',
          sourceExcerpt: 'Operator enters competitive arena against Anthropic computer use.',
          confidenceScore: 0.88,
        },
      ],
    });

    // Fact Verification for the claims:
    mockProvider.enqueueStructuredResponse({
      entailment: 'supports',
      verbatimExcerpt: 'OpenAI announces Operator, a research preview of an autonomous agent that can execute tasks in web browsers.',
      rationale: 'Primary text directly confirms browser task execution.',
      confidenceScore: 0.99,
    });

    mockProvider.enqueueStructuredResponse({
      entailment: 'inconclusive',
      verbatimExcerpt: '',
      rationale: 'Competitive comparison not mentioned in primary release notes.',
      confidenceScore: 0.70,
    });

    // Researcher Agent builds packet
    const researcher = new MultiSourceResearcherAgent(mockProvider);
    const packet = await researcher.buildEvidencePacket(story.id);

    expect(packet.storyId).toBe(story.id);
    expect(packet.primarySources).toHaveLength(1);
    expect(packet.secondarySources).toHaveLength(1);
    expect(packet.confirmedFacts.length).toBeGreaterThanOrEqual(1);
    expect(packet.confirmedFacts[0]).toContain('Operator executes computer tasks');
    expect(packet.differingPerspectives.length).toBeGreaterThanOrEqual(1);

    // Synthesis Agent response:
    mockProvider.enqueueStructuredResponse({
      title: 'OpenAI Launches Operator Agent for Browser Automation',
      deck: 'A new frontier agent capability targets multi-step web navigation and workflow execution.',
      slug: 'openai-launches-operator-agent-browser-automation',
      contentMarkdown:
        'OpenAI has officially launched Operator[^1], introducing autonomous web navigation to Pro users. Industry observers note direct competition with Anthropic computer use[^2].',
      metaDescription: 'OpenAI launches Operator agent for autonomous web browser automation.',
      citations: [
        {
          citationIndex: 1,
          claimIndex: 0,
          anchorText: 'OpenAI Operator',
          primarySourceUrl: 'https://openai.com/blog/operator-launch',
          sourcePublisher: 'OpenAI Newsroom',
        },
        {
          citationIndex: 2,
          claimIndex: 1,
          anchorText: 'competition',
          primarySourceUrl: 'https://techcrunch.com/openai-operator-autonomous-agent',
          sourcePublisher: 'TechCrunch AI',
        },
      ],
    });

    // Writer Agent synthesizes article
    const writer = new MultiSourceWriterAgent(mockProvider);
    const article = await writer.synthesizeStoryArticle(packet);

    expect(article.id).toBeDefined();
    expect(article.title).toContain('OpenAI Launches Operator');
    expect(article.status).toBe('review_pending');

    // Verify story status updated to published
    const [updatedStory] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, story.id));

    expect(updatedStory.editorialStatus).toBe('published');
  });

  it('Module 5: AutonomousPhase2Worker executes 3-step cycle and prevents concurrent clustering', async () => {
    const mockIngestionService = {
      ingestSource: vi.fn().mockResolvedValue({
        sourceId: 'src-1',
        sourceName: 'Mock Source',
        totalFetched: 3,
        insertedCount: 2,
        exactDuplicatesSkipped: 1,
        nearDuplicatesSkipped: 0,
        errors: [],
      }),
    };

    const mockClusterer = {
      processUnclustered: vi.fn().mockResolvedValue([]),
    };

    const mockResearcher = {
      buildEvidencePacket: vi.fn().mockResolvedValue({
        storyId: 'story-1',
        primarySources: [{ title: 'Title', url: 'https://example.com', text: 'Text' }],
        secondarySources: [],
        confirmedFacts: ['Fact 1'],
        differingPerspectives: [],
      }),
    };

    const mockWriter = {
      synthesizeStoryArticle: vi.fn().mockResolvedValue({
        id: 'article-1',
        title: 'Synthesized Title',
        slug: 'synthesized-slug',
      }),
    };

    const worker = new AutonomousPhase2Worker({
      ingestionService: mockIngestionService as any,
      clusterer: mockClusterer as any,
      researcher: mockResearcher as any,
      writer: mockWriter as any,
    });

    const summary = await worker.runCycle();

    expect(summary.errors).toHaveLength(0);
    expect(mockClusterer.processUnclustered).toHaveBeenCalledTimes(1);
  });
});
