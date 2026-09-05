import { getDb } from '../../../db';
import * as schema from '../../../db/schema';
import { eq, sql } from 'drizzle-orm';

export async function seedDemoArticlesIfEmpty(): Promise<void> {
  const db = await getDb();

  try {
    const existing = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.articles);

    if (Number(existing[0]?.count || 0) > 0) {
      return;
    }

    console.log('[Seed] Seeding rich bilingual demo articles...');

    // 1. Ensure source exists
    let [sourceAnthropic] = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.baseUrl, 'https://www.anthropic.com/news/rss.xml'))
      .limit(1);

    if (!sourceAnthropic) {
      const [src] = await db
        .insert(schema.sources)
        .values({
          name: 'Anthropic Research',
          baseUrl: 'https://www.anthropic.com/news/rss.xml',
          sourceType: 'rss',
          tier: 'tier_1_official',
          reputationScore: '0.95',
          isActive: true,
        })
        .returning();
      sourceAnthropic = src;
    }

    let [sourceDeepSeek] = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.baseUrl, 'https://github.com/deepseek-ai/DeepSeek-V3'))
      .limit(1);

    if (!sourceDeepSeek) {
      const [src] = await db
        .insert(schema.sources)
        .values({
          name: 'DeepSeek AI',
          baseUrl: 'https://github.com/deepseek-ai/DeepSeek-V3',
          sourceType: 'rss',
          tier: 'tier_1_official',
          reputationScore: '0.92',
          isActive: true,
        })
        .returning();
      sourceDeepSeek = src;
    }

    let [sourceDeepMind] = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.baseUrl, 'https://deepmind.google/discover/blog/'))
      .limit(1);

    if (!sourceDeepMind) {
      const [src] = await db
        .insert(schema.sources)
        .values({
          name: 'Google DeepMind',
          baseUrl: 'https://deepmind.google/discover/blog/',
          sourceType: 'rss',
          tier: 'tier_1_official',
          reputationScore: '0.96',
          isActive: true,
        })
        .returning();
      sourceDeepMind = src;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Story 1: Claude 3.7 Sonnet (Hero Story, Models & LLMs)
    // ─────────────────────────────────────────────────────────────────────────
    const [story1] = await db
      .insert(schema.stories)
      .values({
        title: 'Anthropic Launches Claude 3.7 Sonnet with Unified Hybrid Reasoning Architecture',
        summary: 'Anthropic unifies standard generation and extended thinking modes within a single frontier model, giving developers dynamic token-budget control.',
        category: 'llm_release',
        editorialStatus: 'published',
        riskLevel: 'low',
        importanceScore: 96,
        firstSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        lastUpdatedAt: new Date(),
        primarySourceId: sourceAnthropic.id,
      })
      .returning();

    const [article1] = await db
      .insert(schema.articles)
      .values({
        storyId: story1.id,
        title: 'Anthropic Unveils Claude 3.7 Sonnet with Unified Hybrid Reasoning Architecture',
        titleEn: 'Anthropic Unveils Claude 3.7 Sonnet with Unified Hybrid Reasoning Architecture',
        titleBn: 'অ্যানথ্রপিক প্রকাশ করল ক্লদ ৩.৭ সনেট: সমন্বিত হাইব্রিড রিজনিং আর্কিটেকচার',
        slug: 'anthropic-unveils-claude-3-7-sonnet-hybrid-reasoning',
        deck: 'The new flagship allows developers to programmatically dial between sub-second latency and deep, chain-of-thought exploration.',
        summaryEn: 'The new flagship allows developers to programmatically dial between sub-second latency and deep, chain-of-thought exploration.',
        summaryBn: 'নতুন ফ্ল্যাগশিপ মডেলটি ডেভেলপারদের সাব-সেকেন্ড প্রতিক্রিয়া এবং গভীর চিন্তন প্রক্রিয়ার মধ্যে প্রয়োজন অনুযায়ী বাজেট সমন্বয়ের সুযোগ দেয়।',
        contentMarkdown: `Anthropic has officially announced Claude 3.7 Sonnet, the industry's first frontier model natively unifying standard generation and extended thinking modes within a single architecture[^1].\n\nUnlike predecessor systems that segregated reasoning into separate, high-latency model checkpoints, Claude 3.7 enables developers to dynamically calibrate thinking token budgets from zero up to 128,000 tokens[^2]. This granular steering allows applications to optimize for real-time responsiveness during conversational queries while reserving compute-intensive multi-step reasoning for difficult software engineering, mathematics, and formal verification problems.\n\nEvaluation benchmarks indicate substantial leaps across competitive programming and complex agentic workflows, setting a new paradigm for flexible inference-time scaling.`,
        contentEn: `Anthropic has officially announced Claude 3.7 Sonnet, the industry's first frontier model natively unifying standard generation and extended thinking modes within a single architecture[^1].\n\nUnlike predecessor systems that segregated reasoning into separate, high-latency model checkpoints, Claude 3.7 enables developers to dynamically calibrate thinking token budgets from zero up to 128,000 tokens[^2]. This granular steering allows applications to optimize for real-time responsiveness during conversational queries while reserving compute-intensive multi-step reasoning for difficult software engineering, mathematics, and formal verification problems.\n\nEvaluation benchmarks indicate substantial leaps across competitive programming and complex agentic workflows, setting a new paradigm for flexible inference-time scaling.`,
        contentBn: `অ্যানথ্রপিক আনুষ্ঠানিকভাবে ক্লদ ৩.৭ সনেট (Claude 3.7 Sonnet) উন্মোচন করেছে, যা কৃত্রিম বুদ্ধিমত্তা শিল্পের প্রথম ফ্রন্টিয়ার মডেল হিসেবে সাধারণ প্রতিক্রিয়া ও বর্ধিত চিন্তন প্রক্রিয়াকে একক আর্কিটেকচারে একীভূত করেছে[^1]।\n\nপূর্ববর্তী মডেলগুলোর বিপরীতে, যেখানে রিজনিংয়ের জন্য সম্পূর্ণ ভিন্ন এবং উচ্চ-বিলম্বতার মডেল ব্যবহার করতে হতো, ক্লদ ৩.৭-এ ডেভেলপাররা ০ থেকে শুরু করে ১২৮,০০০ টোকেন পর্যন্ত চিন্তন বাজেট সুনির্দিষ্টভাবে নির্ধারণ করতে পারবেন[^2]। এই সুবিধার ফলে সাধারণ কথোপকথনে সাব-সেকেন্ড প্রতিক্রিয়া নিশ্চিত করার পাশাপাশি সফটওয়্যার ইঞ্জিনিয়ারিং ও জটিল গাণিতিক সমস্যা সমাধানে গভীর যুক্তিভিত্তিক চিন্তন ব্যবহার করা সম্ভব হবে।\n\nকোডিং প্রতিযোগিতা এবং অটোনোমাস এজেন্ট ওয়ার্কফ্লোতে নতুন এই মডেলটি ফ্রন্টিয়ার স্তরের কার্যক্ষমতা প্রদর্শন করেছে।`,
        keyTakeawaysEn: [
          'First frontier model unifying standard generation and extended thinking modes.',
          'Granular API controls enable steering reasoning token budgets up to 128,000 tokens.',
          'Substantial benchmark improvements across SWE-bench and competitive coding.',
        ],
        keyTakeawaysBn: [
          'প্রথম ফ্রন্টিয়ার মডেল যা সাধারণ জেনারেশন এবং চিন্তন মোডকে একীভূত করেছে।',
          '১২৮,০০০ টোকেন পর্যন্ত চিন্তন বাজেট নির্ধারণের সুনির্দিষ্ট এপিআই নিয়ন্ত্রণ।',
          'কোডিং বেঞ্চমার্ক ও সফটওয়্যার ইঞ্জিনিয়ারিং ওয়ার্কফ্লোতে অভূতপূর্ব অগ্রগতি।',
        ],
        metaDescription: 'Anthropic launches Claude 3.7 Sonnet featuring dynamic hybrid reasoning and token-budget controls.',
        status: 'published',
        confidenceScore: '0.99',
        nGramMaxSimilarity: '0.04',
        readingTimeMinutes: 3,
        publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      })
      .returning();

    await db.insert(schema.articleCitations).values([
      {
        articleId: article1.id,
        citationIndex: 1,
        anchorText: 'first frontier model natively unifying standard generation and extended thinking',
        primarySourceUrl: 'https://www.anthropic.com/news/claude-3-7-sonnet',
        sourcePublisher: 'Anthropic Research',
      },
      {
        articleId: article1.id,
        citationIndex: 2,
        anchorText: 'dynamically calibrate thinking token budgets from zero up to 128,000 tokens',
        primarySourceUrl: 'https://www.anthropic.com/news/claude-3-7-sonnet',
        sourcePublisher: 'Anthropic Research',
      },
    ]);

    // ─────────────────────────────────────────────────────────────────────────
    // Story 2: DeepSeek-V3 MoE (AI Infrastructure)
    // ─────────────────────────────────────────────────────────────────────────
    const [story2] = await db
      .insert(schema.stories)
      .values({
        title: 'DeepSeek Open-Sources DeepSeek-V3 with 671B Mixture-of-Experts Architecture',
        summary: 'DeepSeek releases full model weights and architecture specifications for DeepSeek-V3, activating 37B parameters per token via Multi-Head Latent Attention.',
        category: 'infra',
        editorialStatus: 'published',
        riskLevel: 'low',
        importanceScore: 92,
        firstSeenAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
        lastUpdatedAt: new Date(),
        primarySourceId: sourceDeepSeek.id,
      })
      .returning();

    const [article2] = await db
      .insert(schema.articles)
      .values({
        storyId: story2.id,
        title: 'DeepSeek Open-Sources DeepSeek-V3 with 671B Mixture-of-Experts Architecture',
        titleEn: 'DeepSeek Open-Sources DeepSeek-V3 with 671B Mixture-of-Experts Architecture',
        titleBn: 'ডিপসিক উন্মুক্ত করল ডিপসিক-ভি৩: ৬৭১ বিলিয়ন প্যারামিটারের আর্কিটেকচার',
        slug: 'deepseek-open-sources-deepseek-v3-moe',
        deck: 'Fine-grained routing activates 37B parameters per token, delivering competitive frontier performance at reduced training cost.',
        summaryEn: 'Fine-grained routing activates 37B parameters per token, delivering competitive frontier performance at reduced training cost.',
        summaryBn: 'প্রতি টোকেনে ৩৭ বিলিয়ন প্যারামিটার সক্রিয় করে অত্যন্ত কম খরচে আন্তর্জাতিক মানের ফ্রন্টিয়ার এআই কার্যক্ষমতা নিশ্চিত করছে।',
        contentMarkdown: `Artificial intelligence research lab DeepSeek has officially released the model weights and architecture specifications for DeepSeek-V3[^1].\n\nThe model implements an advanced Mixture-of-Experts (MoE) topology encompassing 671 billion total parameters, with exactly 37 billion activated for any individual token prediction. By utilizing multi-head latent attention (MLA) and FP8 mixed-precision training, the team demonstrated substantial compute efficiency gains during pre-training compared to dense transformer baselines.`,
        contentEn: `Artificial intelligence research lab DeepSeek has officially released the model weights and architecture specifications for DeepSeek-V3[^1].\n\nThe model implements an advanced Mixture-of-Experts (MoE) topology encompassing 671 billion total parameters, with exactly 37 billion activated for any individual token prediction. By utilizing multi-head latent attention (MLA) and FP8 mixed-precision training, the team demonstrated substantial compute efficiency gains during pre-training compared to dense transformer baselines.`,
        contentBn: `কৃত্রিম বুদ্ধিমত্তা গবেষণাগার ডিপসিক (DeepSeek) তাদের নতুন মডেল ডিপসিক-ভি৩ (DeepSeek-V3)-এর ওজন (weights) ও স্থাপত্য সংক্রান্ত বিশদ বিবরণ উন্মুক্ত করেছে[^1]।\n\nমডেলটিতে একটি উন্নত মিক্সচার-অফ-এক্সপার্টস (MoE) ব্যবস্থা প্রয়োগ করা হয়েছে যার মোট প্যারামিটার সংখ্যা ৬৭১ বিলিয়ন, তবে যেকোনো একটি টোকেন অনুমানের জন্য মাত্র ৩৭ বিলিয়ন প্যারামিটার সক্রিয় হয়। মাল্টি-হেড লেটেন্ট অ্যাটেনশন (MLA) এবং এফপি৮ মিক্সড-প্রিসিশন প্রশিক্ষণের মাধ্যমে মডেলটি ডেন্স ট্রান্সফরমার মডেলগুলোর তুলনায় অত্যন্ত কম কম্পিউট খরচে প্রস্তুত করা সম্ভব হয়েছে।`,
        keyTakeawaysEn: [
          '671B total parameters with fine-grained 37B active routing per token.',
          'Multi-head Latent Attention (MLA) architecture reduces KV cache footprint.',
          'Trained on 14.8 trillion tokens using FP8 mixed-precision stability.',
        ],
        keyTakeawaysBn: [
          '৬৭১ বিলিয়ন মোট প্যারামিটার এবং ৩৭ বিলিয়ন সক্রিয় রাউটিং।',
          'মাল্টি-হেড লেটেন্ট অ্যাটেনশন কেভি ক্যাশ মেমরি উল্লেখযোগ্যভাবে কমায়।',
          'এফপি৮ মিক্সড-প্রিসিশনে ১৪.৮ ট্রিলিয়ন টোকেনের মাধ্যমে প্রশিক্ষিত।',
        ],
        metaDescription: 'DeepSeek-V3 open model released with 671B parameters and fine-grained expert routing.',
        status: 'published',
        confidenceScore: '0.98',
        nGramMaxSimilarity: '0.03',
        readingTimeMinutes: 3,
        publishedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
      })
      .returning();

    await db.insert(schema.articleCitations).values([
      {
        articleId: article2.id,
        citationIndex: 1,
        anchorText: '671 billion total parameters, with exactly 37 billion activated',
        primarySourceUrl: 'https://github.com/deepseek-ai/DeepSeek-V3',
        sourcePublisher: 'DeepSeek AI',
      },
    ]);

    // ─────────────────────────────────────────────────────────────────────────
    // Story 3: AlphaGeometry 2 (Research Papers)
    // ─────────────────────────────────────────────────────────────────────────
    const [story3] = await db
      .insert(schema.stories)
      .values({
        title: 'Google DeepMind Demonstrates AlphaGeometry 2 with 83% Olympiad Geometry Benchmark',
        summary: 'A neuro-symbolic reasoning engine couples intuitive Gemini hypothesis generation with deterministic formal deduction, solving 83% of IMO geometry problems.',
        category: 'research',
        editorialStatus: 'published',
        riskLevel: 'low',
        importanceScore: 89,
        firstSeenAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
        lastUpdatedAt: new Date(),
        primarySourceId: sourceDeepMind.id,
      })
      .returning();

    const [article3] = await db
      .insert(schema.articles)
      .values({
        storyId: story3.id,
        title: 'Google DeepMind Demonstrates AlphaGeometry 2 with 83% Olympiad Geometry Benchmark',
        titleEn: 'Google DeepMind Demonstrates AlphaGeometry 2 with 83% Olympiad Geometry Benchmark',
        titleBn: 'গুগল ডিপমাইন্ড উন্মোচন করল আলফাজিওমেট্রি ২: অলিম্পিয়াড জ্যামিতিতে ৮৩% সাফল্য',
        slug: 'deepmind-alphageometry-2-olympiad-geometry-breakthrough',
        deck: 'A neuro-symbolic reasoning engine demonstrates breakthrough automated geometric deduction capabilities.',
        summaryEn: 'A neuro-symbolic reasoning engine demonstrates breakthrough automated geometric deduction capabilities.',
        summaryBn: 'নিউরো-সিম্বলিক রিজনিং ইঞ্জিন যা ভাষার মডেলের অনুমান এবং সুনির্দিষ্ট গাণিতিক প্রমাণের সমন্বয় ঘটায়।',
        contentMarkdown: `Google DeepMind has introduced AlphaGeometry 2, an advanced neuro-symbolic AI system capable of solving 83 percent of International Mathematical Olympiad (IMO) geometry problems across the past 25 years[^1].\n\nThe architecture couples a fine-tuned Gemini language model for intuitive hypothesis generation with a deterministic symbolic deduction engine, preventing mathematical hallucination.`,
        contentEn: `Google DeepMind has introduced AlphaGeometry 2, an advanced neuro-symbolic AI system capable of solving 83 percent of International Mathematical Olympiad (IMO) geometry problems across the past 25 years[^1].\n\nThe architecture couples a fine-tuned Gemini language model for intuitive hypothesis generation with a deterministic symbolic deduction engine, preventing mathematical hallucination.`,
        contentBn: `গুগল ডিপমাইন্ড উন্মোচন করেছে আলফাজিওমেট্রি ২ (AlphaGeometry 2), যা বিগত ২৫ বছরের আন্তর্জাতিক গণিত অলিম্পিয়াডের (IMO) জ্যামিতি সংক্রান্ত সমস্যার ৮৩ শতাংশ সমাধান করতে সক্ষম[^1]।\n\nএই সিস্টেমে ফাইন-টিউনড জেমিনাই মডেলের অনুমিত অনুসিদ্ধান্ত তৈরির ক্ষমতার সাথে একটি সুনির্দিষ্ট প্রতীকী প্রমাণ ইঞ্জিন সংযুক্ত করা হয়েছে, যা কৃত্রিম বুদ্ধিমত্তার গাণিতিক ভুল বা হ্যালুসিনেশন সম্পূর্ণ প্রতিরোধ করে।`,
        keyTakeawaysEn: [
          'Successfully solves 83% of all historical IMO geometry problems from 2000-2024.',
          'Couples Gemini language model with deterministic symbolic deduction algebra.',
          'Discovers faster and more concise geometric proofs than historical human solutions.',
        ],
        keyTakeawaysBn: [
          '২০০০-২০২৪ সালের ৮৩% আন্তর্জাতিক গণিত অলিম্পিয়াড জ্যামিতি সমস্যা সমাধানে সক্ষম।',
          'ভাষাগত মডেলের সাথে সুনির্দিষ্ট সিম্বলিক ডিডাকশন ইঞ্জিনের সমন্বয়।',
          'মানুষের ঐতিহাসিক প্রমাণের চেয়েও দ্রুত ও সংক্ষিপ্ত সমাধান আবিষ্কার করেছে।',
        ],
        metaDescription: 'AlphaGeometry 2 achieves 83% success rate on IMO Olympiad geometry challenges.',
        status: 'published',
        confidenceScore: '0.99',
        nGramMaxSimilarity: '0.03',
        readingTimeMinutes: 3,
        publishedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
      })
      .returning();

    await db.insert(schema.articleCitations).values([
      {
        articleId: article3.id,
        citationIndex: 1,
        anchorText: 'solving 83 percent of International Mathematical Olympiad (IMO) geometry problems',
        primarySourceUrl: 'https://deepmind.google/discover/blog/alphageometry-2',
        sourcePublisher: 'Google DeepMind',
      },
    ]);

    console.log('[Seed] Demo articles seeded successfully.');
  } catch (err) {
    console.warn('[Seed] Could not seed demo articles:', err);
  }
}
