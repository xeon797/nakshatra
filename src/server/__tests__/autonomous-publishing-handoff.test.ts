import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { getDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';
import { MultiSourceWriterAgent } from '../agents/writer';
import { AutonomousPhase2Worker } from '../worker';
import { ArticleManager } from '../../services/editorial/article-manager';
import { MockAiProvider } from '../../services/ai/mock-provider';
import { EvidencePacket } from '../agents/researcher';

describe('STEP 2: Autonomous Publishing Handoff & Editorial State Machine', () => {
  let mockProvider: MockAiProvider;
  let articleManager: ArticleManager;

  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  beforeEach(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  afterEach(() => {
    mockProvider?.clear();
  });

  it('PATH A: Auto-approved story synthesizes into published article with publishedAt and appears in public feed', async () => {
    const db = await getDb();
    mockProvider = new MockAiProvider();
    articleManager = new ArticleManager();

    // 1. Ingest source and raw article
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'OpenAI Newsroom',
        baseUrl: 'https://openai.com/newsroom-auto-pub',
        sourceType: 'rss',
        tier: 'tier_1_official',
      })
      .returning();

    const [raw] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: source.id,
        canonicalUrl: 'https://openai.com/index/gpt-5-preview',
        title: 'OpenAI Announces Frontier Reasoning Model GPT-5',
        cleanText: 'OpenAI has officially announced GPT-5 with multimodal reasoning and agent tools.',
        rawContent: '<p>OpenAI has officially announced GPT-5 with multimodal reasoning and agent tools.</p>',
        contentHash: `hash_auto_pub_${Date.now()}`,
      })
      .returning();

    // 2. Story created by clusterer with editorialStatus = 'auto_approved'
    const [story] = await db
      .insert(schema.stories)
      .values({
        title: 'OpenAI Announces Frontier Reasoning Model GPT-5',
        summary: 'Frontier AI breakthrough with autonomous agent capabilities.',
        category: 'llm_release',
        editorialStatus: 'auto_approved',
        riskLevel: 'low',
        importanceScore: 95,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
        primarySourceId: source.id,
      })
      .returning();

    await db.insert(schema.storySources).values({
      storyId: story.id,
      rawArticleId: raw.id,
      isPrimary: true,
    });

    // 3. Mock AI bilingual response
    const expectedSlug = `openai-frontier-reasoning-gpt5-${Date.now()}`;
    mockProvider.enqueueStructuredResponse({
      slug: expectedSlug,
      en: {
        title: 'OpenAI Announces Frontier Reasoning Model GPT-5',
        summary: 'Frontier AI breakthrough with autonomous agent capabilities.',
        content: 'In an official release, engineers unveiled the GPT-5 system[^1], demonstrating advanced multimodal reasoning capabilities.',
        keyTakeaways: ['New frontier architecture', 'Verified benchmark performance'],
      },
      bn: {
        title: 'ওপেনএআই ঘোষণা করল ফ্রন্টিয়ার রিজনিং মডেল জিপিটি-৫',
        summary: 'স্বায়ত্তশাসিত এজেন্ট সক্ষমতাসহ ফ্রন্টিয়ার এআই ব্রেকথ্রু।',
        content: 'ওপেনএআই আনুষ্ঠানিকভাবে জিপিটি-৫ উন্মোচন করেছে[^1]।',
        keyTakeaways: ['নতুন ফ্রন্টিয়ার আর্কিটেকচার'],
      },
      citations: [
        {
          citationIndex: 1,
          claimIndex: 0,
          anchorText: 'GPT-5 announcement',
          primarySourceUrl: 'https://openai.com/index/gpt-5-preview',
          sourcePublisher: 'OpenAI Newsroom',
        },
      ],
    });

    const packet: EvidencePacket = {
      storyId: story.id,
      primarySources: [
        {
          title: raw.title,
          sourceName: 'OpenAI Newsroom',
          url: raw.canonicalUrl,
          text: raw.cleanText,
          sourceTier: 'tier_1_primary',
        },
      ],
      secondarySources: [],
      confirmedFacts: ['OpenAI has officially announced GPT-5 with multimodal reasoning and agent tools.'],
      differingPerspectives: [],
    };

    // 4. Writer Agent synthesizes article
    const writer = new MultiSourceWriterAgent(mockProvider);
    const article = await writer.synthesizeStoryArticle(packet);

    // 5. Verify publication contract: Both story and article are published
    expect(article.id).toBeDefined();
    expect(article.status).toBe('published');
    expect(article.publishedAt).toBeInstanceOf(Date);

    const [persistedStory] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, story.id));
    expect(persistedStory.editorialStatus).toBe('published');
    expect(persistedStory.processingStatus).toBe('completed');

    // 6. Public Website Query Verification: Article MUST appear in public query
    const publicArticles = await articleManager.getPublishedArticlesWithMetadata(50, 0);
    const foundInPublic = publicArticles.find((a) => a.id === article.id);

    expect(foundInPublic).toBeDefined();
    expect(foundInPublic?.title).toBe('OpenAI Announces Frontier Reasoning Model GPT-5');
    expect(foundInPublic?.status).toBe('published');
    expect(foundInPublic?.publishedAt).toBeDefined();

    // 7. Public Slug Detail View Verification
    const publicDetail = await articleManager.getArticleBySlug(article.slug);
    expect(publicDetail).not.toBeNull();
    expect(publicDetail?.status).toBe('published');
    expect(publicDetail?.citations).toHaveLength(1);
    expect(publicDetail?.citations[0].anchorText).toBe('GPT-5 announcement');
  });

  it('PATH B: High-risk/needs_review story remains review_pending, excluded from public queries until manually approved', async () => {
    const db = await getDb();
    mockProvider = new MockAiProvider();
    articleManager = new ArticleManager();

    // 1. Ingest source and high-risk raw article
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'Tech Legal Wire',
        baseUrl: `https://techlegalwire.com/feed-${Date.now()}`,
        sourceType: 'rss',
        tier: 'tier_2_verified',
      })
      .returning();

    const [raw] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: source.id,
        canonicalUrl: `https://techlegalwire.com/antitrust-lawsuit-${Date.now()}`,
        title: 'Federal Regulators File Antitrust Lawsuit Against AI Lab',
        cleanText: 'Regulators allege anticompetitive exclusive compute partnerships.',
        rawContent: '<p>Regulators allege anticompetitive exclusive compute partnerships.</p>',
        contentHash: `hash_needs_review_${Date.now()}`,
      })
      .returning();

    // 2. Story triage marks as needs_review due to high risk
    const [story] = await db
      .insert(schema.stories)
      .values({
        title: 'Federal Regulators File Antitrust Lawsuit Against AI Lab',
        summary: 'Regulatory lawsuit allegations requiring editorial fact checking.',
        category: 'policy',
        editorialStatus: 'needs_review',
        riskLevel: 'high',
        importanceScore: 85,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
        primarySourceId: source.id,
      })
      .returning();

    await db.insert(schema.storySources).values({
      storyId: story.id,
      rawArticleId: raw.id,
      isPrimary: true,
    });

    const pendingSlug = `antitrust-lawsuit-draft-${Date.now()}`;
    mockProvider.enqueueStructuredResponse({
      slug: pendingSlug,
      en: {
        title: 'Federal Regulators File Antitrust Lawsuit Against AI Lab',
        summary: 'Regulatory lawsuit allegations requiring editorial fact checking.',
        content: 'Regulators have initiated antitrust legal proceedings[^1].',
        keyTakeaways: ['Federal antitrust suit filed'],
      },
      bn: {
        title: 'এআই ল্যাবের বিরুদ্ধে নিয়ন্ত্রক সংস্থার অ্যান্টিট্রাস্ট মামলা',
        summary: 'নিয়ন্ত্রক সংস্থার মামলা সংক্রান্ত প্রতিবেদন।',
        content: 'নিয়ন্ত্রক সংস্থা আনুষ্ঠানিক অভিযোগ দায়ের করেছে[^1]।',
        keyTakeaways: ['মামলা দায়ের'],
      },
      citations: [
        {
          citationIndex: 1,
          claimIndex: 0,
          anchorText: 'antitrust suit',
          primarySourceUrl: raw.canonicalUrl,
          sourcePublisher: 'Tech Legal Wire',
        },
      ],
    });

    const packet: EvidencePacket = {
      storyId: story.id,
      primarySources: [
        {
          title: raw.title,
          sourceName: 'Tech Legal Wire',
          url: raw.canonicalUrl,
          text: raw.cleanText,
          sourceTier: 'tier_2_verified',
        },
      ],
      secondarySources: [],
      confirmedFacts: ['Regulators allege anticompetitive exclusive compute partnerships.'],
      differingPerspectives: [],
    };

    // 3. Writer synthesizes the story
    const writer = new MultiSourceWriterAgent(mockProvider);
    const draftArticle = await writer.synthesizeStoryArticle(packet);

    // 4. Assert Review Safety Invariants: Article MUST NOT be published
    expect(draftArticle.status).toBe('review_pending');
    expect(draftArticle.publishedAt).toBeNull();

    const [persistedStory] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, story.id));
    expect(persistedStory.editorialStatus).toBe('needs_review');

    // 5. Public Website Query Verification: Article MUST NOT appear in public feed
    const publicArticles = await articleManager.getPublishedArticlesWithMetadata(50, 0);
    const foundInPublic = publicArticles.find((a) => a.id === draftArticle.id);
    expect(foundInPublic).toBeUndefined();

    // 6. Newsroom Review Queue: Article MUST appear in pending review queue
    const pendingQueue = await articleManager.getPendingReviewQueue();
    const foundInQueue = pendingQueue.find((a) => a.id === draftArticle.id);
    expect(foundInQueue).toBeDefined();

    // 7. Human Approval: Editor explicitly approves the draft
    await articleManager.approveArticle(draftArticle.id, 'lead_editor_marcus');

    // 8. Post-Approval Verification: Article and story are now published
    const [approvedArticle] = await db
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.id, draftArticle.id));
    expect(approvedArticle.status).toBe('published');
    expect(approvedArticle.publishedAt).toBeInstanceOf(Date);

    const [approvedStory] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, story.id));
    expect(approvedStory.editorialStatus).toBe('published');

    // 9. Article now appears in public feed
    const updatedPublicArticles = await articleManager.getPublishedArticlesWithMetadata(50, 0);
    const publishedInFeed = updatedPublicArticles.find((a) => a.id === draftArticle.id);
    expect(publishedInFeed).toBeDefined();
    expect(publishedInFeed?.status).toBe('published');
  });

  it('IDEMPOTENCY / RETRY SAFETY: Repeated synthesis for the same story updates existing record without creating duplicates', async () => {
    const db = await getDb();
    mockProvider = new MockAiProvider();

    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'Anthropic News',
        baseUrl: `https://anthropic.com/feed-idempotent-${Date.now()}`,
        sourceType: 'rss',
      })
      .returning();

    const [story] = await db
      .insert(schema.stories)
      .values({
        title: 'Claude 3.7 Extended Thinking Released',
        summary: 'Hybrid model reasoning analysis.',
        category: 'research',
        editorialStatus: 'auto_approved',
        riskLevel: 'low',
        importanceScore: 90,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
        primarySourceId: source.id,
      })
      .returning();

    const mockResponse1 = {
      slug: `claude-3-7-extended-thinking-${Date.now()}`,
      en: {
        title: 'Claude 3.7 Extended Thinking Released',
        summary: 'Hybrid model reasoning analysis initial synthesis.',
        content: 'Anthropic has unveiled Claude 3.7[^1].',
        keyTakeaways: ['Initial synthesis'],
      },
      bn: {
        title: 'ক্লড ৩.৭ এক্সটেন্ডেড থিংকিং মুক্তি পেয়েছে',
        summary: 'হাইব্রিড রিজনিং মডেল।',
        content: 'অ্যানথ্রপিক ক্লড ৩.৭ উন্মোচন করেছে[^1]।',
        keyTakeaways: ['প্রাথমিক বিশ্লেষণ'],
      },
      citations: [
        {
          citationIndex: 1,
          claimIndex: 0,
          anchorText: 'Claude 3.7',
          primarySourceUrl: 'https://anthropic.com/claude-3-7',
          sourcePublisher: 'Anthropic',
        },
      ],
    };

    mockProvider.enqueueStructuredResponse(mockResponse1);

    const packet: EvidencePacket = {
      storyId: story.id,
      primarySources: [
        {
          title: story.title,
          sourceName: 'Anthropic',
          url: 'https://anthropic.com/claude-3-7',
          text: 'Anthropic announces Claude 3.7 with extended thinking.',
          sourceTier: 'tier_1_primary',
        },
      ],
      secondarySources: [],
      confirmedFacts: ['Anthropic announces Claude 3.7 with extended thinking.'],
      differingPerspectives: [],
    };

    const writer = new MultiSourceWriterAgent(mockProvider);

    // First synthesis
    const article1 = await writer.synthesizeStoryArticle(packet);
    expect(article1.status).toBe('published');

    // Simulate worker retry or pipeline re-execution for the same story
    // Prepare updated response
    const mockResponse2 = {
      ...mockResponse1,
      en: {
        ...mockResponse1.en,
        title: 'Claude 3.7 Extended Thinking Released (Updated)',
        summary: 'Updated synthesis with enhanced evidence.',
      },
    };
    mockProvider.enqueueStructuredResponse(mockResponse2);

    // Reset story to auto_approved as if recovering
    await db
      .update(schema.stories)
      .set({ editorialStatus: 'auto_approved' })
      .where(eq(schema.stories.id, story.id));

    const article2 = await writer.synthesizeStoryArticle(packet);

    // Must be the exact same article ID and slug (NO duplicate row created)
    expect(article2.id).toBe(article1.id);
    expect(article2.slug).toBe(article1.slug);
    expect(article2.title).toBe('Claude 3.7 Extended Thinking Released (Updated)');

    // Verify database has exactly 1 article for this storyId
    const articlesForStory = await db
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.storyId, story.id));

    expect(articlesForStory).toHaveLength(1);
  });

  it('FAILURE ORDERING: synthesis or database failure never marks story as published', async () => {
    const db = await getDb();
    mockProvider = new MockAiProvider();
    articleManager = new ArticleManager();

    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'Failure Test Lab',
        baseUrl: `https://failure-test.com/feed-${Date.now()}`,
        sourceType: 'rss',
      })
      .returning();

    const [story] = await db
      .insert(schema.stories)
      .values({
        title: 'Storydestined To Fail Synthesis',
        summary: 'Testing failure ordering.',
        category: 'research',
        editorialStatus: 'auto_approved',
        riskLevel: 'low',
        importanceScore: 85,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
        primarySourceId: source.id,
      })
      .returning();

    // Set mock to reject
    const brokenWriter = new MultiSourceWriterAgent({
      providerName: 'mock_broken',
      defaultModel: 'mock',
      generateText: async () => { throw new Error('Simulated LLM network crash'); },
      generateStructured: async () => { throw new Error('Simulated LLM network crash'); },
    });

    const packet: EvidencePacket = {
      storyId: story.id,
      primarySources: [{ title: story.title, url: 'https://failure-test.com/doc', text: 'Some text', sourceName: 'Lab' }],
      secondarySources: [],
      confirmedFacts: ['Some fact'],
      differingPerspectives: [],
    };

    // Synthesize should fail
    await expect(brokenWriter.synthesizeStoryArticle(packet)).rejects.toThrow('Simulated LLM network crash');

    // Assert story was NOT marked published
    const [persistedStory] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, story.id));

    expect(persistedStory.editorialStatus).not.toBe('published');
    expect(persistedStory.editorialStatus).toBe('auto_approved');

    // Assert no article was created in public query
    const publicArticles = await articleManager.getPublishedArticlesWithMetadata(50, 0);
    const foundArticle = publicArticles.find((a) => a.title === story.title);
    expect(foundArticle).toBeUndefined();
  });

  it('END-TO-END WORKER FLOW: worker.runCycle() automatically publishes auto_approved stories and increments summary counter', async () => {
    const db = await getDb();
    mockProvider = new MockAiProvider();
    articleManager = new ArticleManager();

    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'DeepMind Announcements',
        baseUrl: `https://deepmind.google/feed-e2e-${Date.now()}`,
        sourceType: 'rss',
        isActive: false, // Inactive so worker step 1 skips polling
      })
      .returning();

    const [raw] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: source.id,
        canonicalUrl: `https://deepmind.google/discover/blog/gemini-robotics-${Date.now()}`,
        title: 'Google DeepMind Unveils Gemini Robotics Engine',
        cleanText: 'DeepMind scientists have published a new spatial foundation model for robotics.',
        rawContent: '<p>DeepMind scientists have published a new spatial foundation model for robotics.</p>',
        contentHash: `hash_worker_e2e_${Date.now()}`,
      })
      .returning();

    const [story] = await db
      .insert(schema.stories)
      .values({
        title: 'Google DeepMind Unveils Gemini Robotics Engine',
        summary: 'Spatial foundation model for robotic embodied intelligence.',
        category: 'research',
        editorialStatus: 'auto_approved',
        riskLevel: 'low',
        importanceScore: 92,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
        primarySourceId: source.id,
      })
      .returning();

    await db.insert(schema.storySources).values({
      storyId: story.id,
      rawArticleId: raw.id,
      isPrimary: true,
    });

    const expectedSlug = `gemini-robotics-engine-${Date.now()}`;
    mockProvider.enqueueStructuredResponse({
      slug: expectedSlug,
      en: {
        title: 'Google DeepMind Unveils Gemini Robotics Engine',
        summary: 'Spatial foundation model for robotic embodied intelligence.',
        content: 'In an expansive breakthrough, researchers unveiled the new spatial robotics system[^1].',
        keyTakeaways: ['Robotics foundation model', 'Embodied spatial awareness'],
      },
      bn: {
        title: 'গুগল ডিপমাইন্ড উন্মোচন করল জেমিনাই রোবোটিক্স ইঞ্জিন',
        summary: 'রোবোটিক্সের জন্য স্প্যাশিয়াল ফাউন্ডেশন মডেল।',
        content: 'ডিপমাইন্ডের গবেষকরা রোবোটিক্সের জন্য নতুন মডেল উন্মোচন করেছেন[^1]।',
        keyTakeaways: ['রোবোটিক্স অগ্রগতি'],
      },
      citations: [
        {
          citationIndex: 1,
          claimIndex: 0,
          anchorText: 'robotics system',
          primarySourceUrl: raw.canonicalUrl,
          sourcePublisher: 'DeepMind',
        },
      ],
    });

    const worker = new AutonomousPhase2Worker({
      writer: new MultiSourceWriterAgent(mockProvider),
      ingestionService: {
        ingestSource: async () => ({ insertedCount: 0, errors: [] }),
      } as any,
    });

    const summary = await worker.runCycle({ forceAllSources: false });

    expect(summary.autoApprovedArticlesPublished).toBeGreaterThanOrEqual(1);

    // Verify story state in DB
    const [persistedStory] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, story.id));

    expect(persistedStory.editorialStatus).toBe('published');
    expect(persistedStory.processingStatus).toBe('completed');

    // Verify article state in DB
    const [persistedArticle] = await db
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.storyId, story.id));

    expect(persistedArticle).toBeDefined();
    expect(persistedArticle.status).toBe('published');
    expect(persistedArticle.publishedAt).toBeInstanceOf(Date);

    // Verify public feed contains this article
    const publicArticles = await articleManager.getPublishedArticlesWithMetadata(50, 0);
    const inFeed = publicArticles.find((a) => a.id === persistedArticle.id);
    expect(inFeed).toBeDefined();
    expect(inFeed?.status).toBe('published');
  }, 15000);
});
