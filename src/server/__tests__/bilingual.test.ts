import { describe, it, expect, beforeAll } from 'vitest';
import { getDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';
import { MultiSourceWriterAgent } from '../agents/writer';
import { MockAiProvider } from '../../services/ai/mock-provider';
import { NewsletterService } from '../services/newsletter-service';
import { renderDailyDigestHtml } from '../../emails/daily-digest';
import { renderDailyDigestBnHtml } from '../../emails/daily-digest-bn';
import { ensureLatinSlug } from '../../services/editorial/synthesis-agent';
import { EvidencePacket } from '../agents/researcher';

describe('Phase 3.5: Full Bilingual Architecture (English & Bengali)', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  it('Module 2: Schema validation - articles table persists both English and Bengali fields', async () => {
    const db = await getDb();

    const [article] = await db
      .insert(schema.articles)
      .values({
        title: 'Anthropic Unveils Claude 3.7 Sonnet',
        slug: 'anthropic-unveils-claude-3-7-sonnet',
        deck: 'Hybrid reasoning model integrates instant response with chain-of-thought.',
        contentMarkdown: 'Full English analysis [^1].',
        titleEn: 'Anthropic Unveils Claude 3.7 Sonnet with Hybrid Reasoning',
        titleBn: 'অ্যানথ্রপিক প্রকাশ করল হাইব্রিড রিজনিং মডেল ক্লড ৩.৭ সনেট',
        summaryEn: 'Claude 3.7 Sonnet combines instant response with extended chain-of-thought.',
        summaryBn: 'ক্লড ৩.৭ সনেট তাৎক্ষণিক উত্তর ও বিস্তারিত চিন্তা-প্রক্রিয়ার সমন্বয়ে তৈরি।',
        contentEn: 'Anthropic has introduced Claude 3.7 Sonnet [^1], offering selectable thinking budget.',
        contentBn: 'অ্যানথ্রপিক ক্লড ৩.৭ সনেট (Claude 3.7 Sonnet) মডেল উন্মোচন করেছে [^1]। এতে ব্যবহারকারী থিংকিং বাজেট নির্ধারণ করতে পারবেন।',
        keyTakeawaysEn: ['Hybrid reasoning architecture', 'Selectable thinking budget'],
        keyTakeawaysBn: ['হাইব্রিড রিজনিং আর্কিটেকচার', 'থিংকিং বাজেট নির্ধারণ সুবিধা'],
        metaDescription: 'Bilingual analysis of Claude 3.7 release.',
        status: 'published',
        readingTimeMinutes: 3,
      })
      .returning();

    expect(article.id).toBeDefined();
    expect(article.titleEn).toBe('Anthropic Unveils Claude 3.7 Sonnet with Hybrid Reasoning');
    expect(article.titleBn).toBe('অ্যানথ্রপিক প্রকাশ করল হাইব্রিড রিজনিং মডেল ক্লড ৩.৭ সনেট');
    expect(article.summaryBn).toContain('ক্লড ৩.৭ সনেট');
    expect(article.contentBn).toContain('থিংকিং বাজেট');
    expect(article.keyTakeawaysBn).toHaveLength(2);
    expect(article.keyTakeawaysEn).toHaveLength(2);

    // Query back from DB
    const [fetched] = await db
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.id, article.id));

    expect(fetched.titleBn).toBe(article.titleBn);
    expect(fetched.contentBn).toBe(article.contentBn);
    expect(fetched.keyTakeawaysBn).toEqual(['হাইব্রিড রিজনিং আর্কিটেকচার', 'থিংকিং বাজেট নির্ধারণ সুবিধা']);
  });

  it('Module 2: Invariant validation - ensureLatinSlug strictly enforces ASCII Latin slugs and cleans Bengali text', () => {
    // 1. Non-latin Bengali slug should fall back to sanitized Latin title
    const bengaliInputSlug = 'মডেল-উন্মোচন-২০২৬';
    const fallbackTitle = 'Gemini 2.5 Pro Multimodal Release';
    const cleanSlug = ensureLatinSlug(bengaliInputSlug, fallbackTitle);

    expect(cleanSlug).toMatch(/^[a-z0-9-]+$/);
    expect(cleanSlug).not.toMatch(/[\u0980-\u09FF]/); // No Bengali unicode characters
    expect(cleanSlug).toBe('gemini-2-5-pro-multimodal-release');

    // 2. Valid Latin slug is preserved
    const validLatinSlug = 'deepmind-alpha-reasoning-breakthrough';
    const preservedSlug = ensureLatinSlug(validLatinSlug, 'Fallback Title');
    expect(preservedSlug).toBe(validLatinSlug);

    // 3. Mixed characters are filtered to Latin alphanumeric and hyphens only
    const messySlug = 'OpenAI_O3-mini!@#$%^&*()_+Update';
    const sanitizedMessy = ensureLatinSlug(messySlug, 'Fallback');
    expect(sanitizedMessy).toMatch(/^[a-z0-9-]+$/);
    expect(sanitizedMessy).toBe('openai-o3-mini-update');
  });

  it('Module 2: MultiSourceWriterAgent executes dual synthesis and stores bilingual fields with Latin slug', async () => {
    const db = await getDb();

    // 1. Seed source and story
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'Google DeepMind',
        baseUrl: 'https://deepmind.google/news/feed.xml',
        sourceType: 'rss',
      })
      .returning();

    const [story] = await db
      .insert(schema.stories)
      .values({
        title: 'DeepMind Unveils Next-Gen Reasoning Model',
        summary: 'A new mathematical reasoning system achieves gold-medal performance.',
        category: 'research',
        editorialStatus: 'auto_approved',
        riskLevel: 'low',
        importanceScore: 92,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
        primarySourceId: source.id,
      })
      .returning();

    const [raw] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: source.id,
        canonicalUrl: 'https://deepmind.google/research/math-reasoning',
        title: 'Next-Gen Reasoning',
        cleanText: 'DeepMind releases frontier reasoning model achieving competitive performance on math benchmarks.',
        rawContent: 'DeepMind releases reasoning.',
        contentHash: 'hash_bilingual_test_raw1',
      })
      .returning();

    await db.insert(schema.storySources).values({
      storyId: story.id,
      rawArticleId: raw.id,
      isPrimary: true,
    });

    // 2. Setup mock AI provider with bilingual draft
    const mockProvider = new MockAiProvider();
    mockProvider.enqueueStructuredResponse({
      slug: 'deepmind-next-gen-reasoning-benchmarks',
      en: {
        title: 'DeepMind Unveils Next-Gen Frontier Reasoning Model',
        summary: 'New architecture demonstrates verified breakthrough performance on complex reasoning benchmarks.',
        content:
          'Researchers at Google DeepMind have introduced a next-generation reasoning model [^1]. The architecture establishes new state-of-the-art results across competitive benchmarks.',
        keyTakeaways: [
          'Frontier reasoning architecture achieves unprecedented problem-solving accuracy.',
          'Evaluated against competitive mathematical and algorithmic benchmarks.',
        ],
      },
      bn: {
        title: 'ডিপমাইন্ড উন্মোচন করল পরবর্তী প্রজন্মের রিজনিং মডেল',
        summary: 'নতুন আর্কিটেকচার জটিল যুক্তি ও গাণিতিক বেঞ্চমার্কে যুগান্তকারী সাফল্য প্রদর্শন করেছে।',
        content:
          'গুগল ডিপমাইন্ডের গবেষক দল পরবর্তী প্রজন্মের একটি রিজনিং মডেল (Reasoning Model) উন্মোচন করেছে [^1]। এই ব্যবস্থা বৈজ্ঞানিক সমস্যা সমাধানের বেঞ্চমার্কে নতুন মানদণ্ড স্থাপন করেছে।',
        keyTakeaways: [
          'পরবর্তী প্রজন্মের রিজনিং আর্কিটেকচারে অভূতপূর্ব সক্ষমতা অর্জিত হয়েছে।',
          'আন্তর্জাতিক গাণিতিক ও অ্যালগরিদমিক বেঞ্চমার্কে পরীক্ষিত ও যাচাইকৃত।',
        ],
      },
      citations: [
        {
          citationIndex: 1,
          claimIndex: 0,
          anchorText: 'next-generation reasoning model',
          primarySourceUrl: 'https://deepmind.google/research/math-reasoning',
          sourcePublisher: 'Google DeepMind',
        },
      ],
    });

    const packet: EvidencePacket = {
      storyId: story.id,
      primarySources: [
        {
          title: 'Next-Gen Reasoning',
          sourceName: 'Google DeepMind',
          url: 'https://deepmind.google/research/math-reasoning',
          text: 'DeepMind releases frontier reasoning model achieving competitive performance on math benchmarks.',
          sourceTier: 'tier_1_primary',
        },
      ],
      secondarySources: [],
      confirmedFacts: ['DeepMind releases frontier reasoning model achieving competitive performance on math benchmarks.'],
      differingPerspectives: [],
    };

    const writerAgent = new MultiSourceWriterAgent(mockProvider);
    const synthesized = await writerAgent.synthesizeStoryArticle(packet);

    expect(synthesized.id).toBeDefined();
    expect(synthesized.titleEn).toContain('DeepMind Unveils Next-Gen');
    expect(synthesized.titleBn).toContain('ডিপমাইন্ড উন্মোচন করল');
    expect(synthesized.contentBn).toContain('রিজনিং মডেল');
    expect(synthesized.slug).toMatch(/^[a-z0-9-]+$/);
    expect(synthesized.keyTakeawaysBn.length).toBeGreaterThanOrEqual(1);
    expect(synthesized.status).toBe('published');
    expect(synthesized.publishedAt).toBeDefined();
  });

  it('Module 4: Subscribers table persists language preference with default "bn"', async () => {
    const service = new NewsletterService();

    // 1. Subscribe without explicit language -> default to 'bn'
    const sub1 = await service.subscribe({
      email: 'default-lang-reader@lab.ai',
      topics: ['all'],
    });

    expect(sub1.success).toBe(true);
    expect(sub1.subscriber.preferredLanguage).toBe('bn');

    // 2. Subscribe with explicit 'en'
    const sub2 = await service.subscribe({
      email: 'english-reader@frontier.org',
      topics: ['models', 'research'],
      preferredLanguage: 'en',
    });

    expect(sub2.success).toBe(true);
    expect(sub2.subscriber.preferredLanguage).toBe('en');

    // 3. Re-subscribe sub1 to switch to 'en' without duplicate PK error
    const sub1Updated = await service.subscribe({
      email: 'default-lang-reader@lab.ai',
      topics: ['infra'],
      preferredLanguage: 'en',
    });

    expect(sub1Updated.success).toBe(true);
    expect(sub1Updated.isNew).toBe(false);
    expect(sub1Updated.subscriber.preferredLanguage).toBe('en');
    expect(sub1Updated.subscriber.topics).toEqual(['infra']);
  });

  it('Module 4: Dual-Language Newsletter HTML templates & delivery routing', async () => {
    const payload = {
      dateStr: 'Friday, September 5, 2026',
      siteUrl: 'https://nakshatra.ai',
      topStory: {
        id: 'story-1',
        title: 'OpenAI Launches Operator Autonomous Agent',
        titleEn: 'OpenAI Launches Operator Autonomous Agent for Browsers',
        titleBn: 'ওপেনএআই উন্মোচন করল ব্রাউজার নিয়ন্ত্রক স্বায়ত্তশাসিত এজেন্ট অপারেটর',
        slug: 'openai-launches-operator-autonomous-agent',
        deck: 'Operator directly controls web browsers to execute complex research tasks.',
        summaryEn: 'Operator directly controls web browsers to execute multi-step workflows.',
        summaryBn: 'অপারেটর সরাসরি ব্রাউজার নিয়ন্ত্রণ করে জটিল গবেষণার কাজ সম্পাদন করে।',
        category: 'agentic',
        sourceNames: ['OpenAI Newsroom'],
      },
      categoryHighlights: [
        {
          category: 'agentic',
          categoryLabel: 'Autonomous Agents',
          stories: [
            {
              id: 'story-2',
              title: 'Agentic Frameworks Benchmark',
              titleEn: 'Agentic Frameworks Comparative Benchmark',
              titleBn: 'এজেন্টিক ফ্রেমওয়ার্ক তুলনামূলক বেঞ্চমার্ক',
              slug: 'agentic-frameworks-comparative-benchmark',
              deck: 'Comparing autonomous execution across frontier LLMs.',
              summaryEn: 'Comprehensive evaluation of tool use.',
              summaryBn: 'টুল ব্যবহারের সমন্বিত মূল্যায়ন প্রতিবেদন।',
              category: 'agentic',
              sourceNames: ['MIT AI Lab'],
            },
          ],
        },
      ],
      quickHits: [
        {
          id: 'story-3',
          title: 'Claude 3.7 Sonnet General Availability',
          titleEn: 'Claude 3.7 Sonnet Reaches General Availability',
          titleBn: 'ক্লড ৩.৭ সনেট উন্মুক্ত করা হলো সর্বসাধারণের জন্য',
          slug: 'claude-3-7-sonnet-general-availability',
          deck: 'Now available in API and workbench.',
          category: 'llm_release',
          sourceNames: ['Anthropic'],
        },
      ],
    };

    // 1. Validate Bengali HTML template
    const bnHtml = renderDailyDigestBnHtml(payload);
    expect(bnHtml).toContain('lang="bn"');
    expect(bnHtml).toContain('charset="utf-8"');
    expect(bnHtml).toContain('line-height: 1.75');
    expect(bnHtml).toContain('Hind Siliguri');
    expect(bnHtml).toContain('ওপেনএআই উন্মোচন করল');
    expect(bnHtml).toContain('আজকের প্রধান খবর');
    expect(bnHtml).toContain('আনসাবস্ক্রাইব করুন');

    // 2. Validate English HTML template
    const enHtml = renderDailyDigestHtml(payload);
    expect(enHtml).toContain('lang="en"');
    expect(enHtml).toContain('charset="utf-8"');
    expect(enHtml).toContain('OpenAI Launches Operator');
    expect(enHtml).toContain('TOP STORY OF THE DAY');
    expect(enHtml).toContain('Unsubscribe');

    // 3. Test delivery routing to both EN and BN subscribers
    const db = await getDb();
    const bnEmail = 'bengali-subscriber@ai.bd';
    const enEmail = 'english-subscriber@ai.com';

    await db
      .insert(schema.subscribers)
      .values([
        {
          email: bnEmail,
          topics: ['all'],
          preferredLanguage: 'bn',
          isActive: true,
        },
        {
          email: enEmail,
          topics: ['all'],
          preferredLanguage: 'en',
          isActive: true,
        },
      ])
      .onConflictDoNothing();

    const service = new NewsletterService();
    const result = await service.sendDailyDigest({ lookbackHours: 48 });

    expect(result.success).toBe(true);
    expect(result.mockMode).toBe(true);
    expect(result.subscribersMatched).toBeGreaterThanOrEqual(2);
    expect(result.emailsSent).toBeGreaterThanOrEqual(2);
    expect(result.errors).toHaveLength(0);
  });
});
