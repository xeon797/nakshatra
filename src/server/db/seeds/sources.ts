import { getDb } from '../../../db';
import * as schema from '../../../db/schema';
import { eq } from 'drizzle-orm';

export interface SeedSourceDefinition {
  name: string;
  baseUrl: string;
  sourceType: string;
  tier: 'tier_1_primary' | 'tier_2_verified' | 'tier_3_aggregator';
  reputationScore: string;
  pollingFrequencyMinutes: number;
  primaryCategory?: 'llm_release' | 'agentic' | 'infra' | 'research' | 'policy';
}

/**
 * Known broken, non-RSS, or duplicate endpoints that must be deactivated / cleaned up
 */
export const INVALID_OR_DEPRECATED_SOURCE_URLS = [
  'https://github.com/deepseek-ai/DeepSeek-V3', // GitHub repository erroneously configured as RSS
  'https://deepmind.google/discover/blog/',     // HTML web page duplicate of deepmind.google/blog/rss.xml
  'https://www.anthropic.com/news/feed',        // 404 - Anthropic has no public first-party RSS endpoint
  'https://www.anthropic.com/news/rss.xml',     // 404 - Anthropic has no public first-party RSS endpoint
  'https://ai.meta.com/blog/rss.xml',           // 404 - Replaced by official Meta Engineering AI research feed
];

export const HIGH_SIGNAL_AI_SOURCES: SeedSourceDefinition[] = [
  // =========================================================================
  // Tier 1: Primary AI Labs, Cloud Infrastructure & Developer Platforms
  // Polling: 15-20m | Reputation: 0.95 - 1.00
  // =========================================================================
  {
    name: 'OpenAI Official Blog',
    baseUrl: 'https://openai.com/news/rss.xml',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '1.00',
    pollingFrequencyMinutes: 15,
    primaryCategory: 'llm_release',
  },
  {
    name: 'Google DeepMind Research',
    baseUrl: 'https://deepmind.google/blog/rss.xml',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '1.00',
    pollingFrequencyMinutes: 15,
    primaryCategory: 'research',
  },
  {
    name: 'Meta AI Research & Engineering',
    baseUrl: 'https://engineering.fb.com/category/ai-research/feed/',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '1.00',
    pollingFrequencyMinutes: 15,
    primaryCategory: 'llm_release',
  },
  {
    name: 'Microsoft Research Blog',
    baseUrl: 'https://www.microsoft.com/en-us/research/blog/feed/',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '1.00',
    pollingFrequencyMinutes: 15,
    primaryCategory: 'research',
  },
  {
    name: 'NVIDIA Newsroom',
    baseUrl: 'https://nvidianews.nvidia.com/releases.xml',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '1.00',
    pollingFrequencyMinutes: 15,
    primaryCategory: 'infra',
  },
  {
    name: 'AWS Machine Learning Blog',
    baseUrl: 'https://aws.amazon.com/blogs/machine-learning/feed/',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '0.95',
    pollingFrequencyMinutes: 20,
    primaryCategory: 'infra',
  },
  {
    name: 'Google Official AI Blog',
    baseUrl: 'https://blog.google/technology/ai/rss/',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '0.95',
    pollingFrequencyMinutes: 20,
    primaryCategory: 'llm_release',
  },
  {
    name: 'Hugging Face Blog',
    baseUrl: 'https://huggingface.co/blog/feed.xml',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '0.95',
    pollingFrequencyMinutes: 15,
    primaryCategory: 'llm_release',
  },
  {
    name: 'GitHub Blog AI',
    baseUrl: 'https://github.blog/category/ai-and-ml/feed/',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '0.95',
    pollingFrequencyMinutes: 20,
    primaryCategory: 'agentic',
  },

  // =========================================================================
  // Tier 2: Academic Preprints, Policy Think Tanks & Technical Practitioners
  // Polling: 20-30m | Reputation: 0.85 - 0.90
  // =========================================================================
  {
    name: 'arXiv cs.AI',
    baseUrl: 'http://export.arxiv.org/rss/cs.AI',
    sourceType: 'arxiv',
    tier: 'tier_2_verified',
    reputationScore: '0.90',
    pollingFrequencyMinutes: 30,
    primaryCategory: 'research',
  },
  {
    name: 'arXiv cs.CL',
    baseUrl: 'http://export.arxiv.org/rss/cs.CL',
    sourceType: 'arxiv',
    tier: 'tier_2_verified',
    reputationScore: '0.90',
    pollingFrequencyMinutes: 30,
    primaryCategory: 'research',
  },
  {
    name: 'Georgetown CSET (Center for Security & Emerging Technology)',
    baseUrl: 'https://cset.georgetown.edu/feed/',
    sourceType: 'rss',
    tier: 'tier_2_verified',
    reputationScore: '0.90',
    pollingFrequencyMinutes: 30,
    primaryCategory: 'policy',
  },
  {
    name: 'Simon Willison AI Weblog',
    baseUrl: 'https://simonwillison.net/atom/everything/',
    sourceType: 'atom',
    tier: 'tier_2_verified',
    reputationScore: '0.90',
    pollingFrequencyMinutes: 20,
    primaryCategory: 'agentic',
  },
  {
    name: 'AI Snake Oil (Princeton)',
    baseUrl: 'https://www.aisnakeoil.com/feed',
    sourceType: 'rss',
    tier: 'tier_2_verified',
    reputationScore: '0.85',
    pollingFrequencyMinutes: 30,
    primaryCategory: 'policy',
  },
  {
    name: 'Import AI (Jack Clark)',
    baseUrl: 'https://importai.substack.com/feed',
    sourceType: 'rss',
    tier: 'tier_2_verified',
    reputationScore: '0.90',
    pollingFrequencyMinutes: 30,
    primaryCategory: 'policy',
  },

  // =========================================================================
  // Tier 3: Reputable Tech Journalism, Semiconductor & Market Analysis
  // Polling: 20-30m | Reputation: 0.75 - 0.80
  // =========================================================================
  {
    name: 'TechCrunch AI',
    baseUrl: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    sourceType: 'rss',
    tier: 'tier_3_aggregator',
    reputationScore: '0.75',
    pollingFrequencyMinutes: 20,
    primaryCategory: 'agentic',
  },
  {
    name: 'The Verge AI',
    baseUrl: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    sourceType: 'rss',
    tier: 'tier_3_aggregator',
    reputationScore: '0.75',
    pollingFrequencyMinutes: 20,
    primaryCategory: 'llm_release',
  },
  {
    name: 'Ars Technica Tech Policy & AI',
    baseUrl: 'https://feeds.arstechnica.com/arstechnica/index',
    sourceType: 'rss',
    tier: 'tier_3_aggregator',
    reputationScore: '0.75',
    pollingFrequencyMinutes: 20,
    primaryCategory: 'policy',
  },
  {
    name: 'MIT Technology Review AI',
    baseUrl: 'https://www.technologyreview.com/topic/artificial-intelligence/feed',
    sourceType: 'rss',
    tier: 'tier_3_aggregator',
    reputationScore: '0.80',
    pollingFrequencyMinutes: 20,
    primaryCategory: 'infra',
  },
  {
    name: 'IEEE Spectrum AI',
    baseUrl: 'https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss',
    sourceType: 'rss',
    tier: 'tier_3_aggregator',
    reputationScore: '0.80',
    pollingFrequencyMinutes: 25,
    primaryCategory: 'infra',
  },
  {
    name: 'SemiAnalysis',
    baseUrl: 'https://www.semianalysis.com/feed',
    sourceType: 'rss',
    tier: 'tier_3_aggregator',
    reputationScore: '0.80',
    pollingFrequencyMinutes: 30,
    primaryCategory: 'infra',
  },
];

export interface SeedSourcesResult {
  inserted: number;
  updated: number;
  deactivated: number;
  totalActive: number;
  skipped: number;
}

export async function seedSources(): Promise<SeedSourcesResult> {
  const db = await getDb();
  let inserted = 0;
  let updated = 0;
  let deactivated = 0;

  // 1. Deactivate known invalid, duplicate, or broken source endpoints
  for (const badUrl of INVALID_OR_DEPRECATED_SOURCE_URLS) {
    const existing = await db
      .select({ id: schema.sources.id, isActive: schema.sources.isActive })
      .from(schema.sources)
      .where(eq(schema.sources.baseUrl, badUrl));

    for (const src of existing) {
      if (src.isActive) {
        await db
          .update(schema.sources)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(schema.sources.id, src.id));
        deactivated++;
      }
    }
  }

  // 2. Insert or update verified high-signal sources
  for (const src of HIGH_SIGNAL_AI_SOURCES) {
    const existing = await db
      .select({ id: schema.sources.id, scrapeRulesJson: schema.sources.scrapeRulesJson })
      .from(schema.sources)
      .where(eq(schema.sources.baseUrl, src.baseUrl))
      .limit(1);

    const rules = ((existing[0]?.scrapeRulesJson as Record<string, unknown>) || {});
    const updatedRules = {
      ...rules,
      primaryCategory: src.primaryCategory,
    };

    if (existing.length === 0) {
      await db.insert(schema.sources).values({
        name: src.name,
        baseUrl: src.baseUrl,
        sourceType: src.sourceType,
        tier: src.tier,
        reputationScore: src.reputationScore,
        pollingFrequencyMinutes: src.pollingFrequencyMinutes,
        isActive: true,
        scrapeRulesJson: updatedRules,
      });
      inserted++;
    } else {
      await db
        .update(schema.sources)
        .set({
          name: src.name,
          sourceType: src.sourceType,
          tier: src.tier,
          reputationScore: src.reputationScore,
          pollingFrequencyMinutes: src.pollingFrequencyMinutes,
          isActive: true,
          updatedAt: new Date(),
          scrapeRulesJson: updatedRules,
        })
        .where(eq(schema.sources.id, existing[0].id));
      updated++;
    }
  }

  const activeRows = await db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(eq(schema.sources.isActive, true));

  return {
    inserted,
    updated,
    deactivated,
    totalActive: activeRows.length,
    skipped: updated,
  };
}
