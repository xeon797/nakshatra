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
}

export const HIGH_SIGNAL_AI_SOURCES: SeedSourceDefinition[] = [
  // Tier 1: Primary AI Labs (15m polling, 1.00 reputation)
  {
    name: 'OpenAI Official Blog',
    baseUrl: 'https://openai.com/news/rss.xml',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '1.00',
    pollingFrequencyMinutes: 15,
  },
  {
    name: 'Anthropic News',
    baseUrl: 'https://www.anthropic.com/news/feed',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '1.00',
    pollingFrequencyMinutes: 15,
  },
  {
    name: 'Google DeepMind Research',
    baseUrl: 'https://deepmind.google/blog/rss.xml',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '1.00',
    pollingFrequencyMinutes: 15,
  },
  {
    name: 'NVIDIA Newsroom',
    baseUrl: 'https://nvidianews.nvidia.com/releases.xml',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '1.00',
    pollingFrequencyMinutes: 15,
  },
  {
    name: 'Hugging Face Blog',
    baseUrl: 'https://huggingface.co/blog/feed.xml',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '1.00',
    pollingFrequencyMinutes: 15,
  },
  {
    name: 'Meta AI Blog',
    baseUrl: 'https://ai.meta.com/blog/rss.xml',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '1.00',
    pollingFrequencyMinutes: 15,
  },

  // Tier 2: Academic & Technical Preprints (30m polling, 0.90 reputation)
  {
    name: 'arXiv cs.AI',
    baseUrl: 'http://export.arxiv.org/rss/cs.AI',
    sourceType: 'arxiv',
    tier: 'tier_2_verified',
    reputationScore: '0.90',
    pollingFrequencyMinutes: 30,
  },
  {
    name: 'arXiv cs.CL',
    baseUrl: 'http://export.arxiv.org/rss/cs.CL',
    sourceType: 'arxiv',
    tier: 'tier_2_verified',
    reputationScore: '0.90',
    pollingFrequencyMinutes: 30,
  },

  // Tier 3: Tech Journalism & Analysis (20m polling, 0.70 reputation)
  {
    name: 'TechCrunch AI',
    baseUrl: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    sourceType: 'rss',
    tier: 'tier_3_aggregator',
    reputationScore: '0.70',
    pollingFrequencyMinutes: 20,
  },
  {
    name: 'The Verge AI',
    baseUrl: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    sourceType: 'rss',
    tier: 'tier_3_aggregator',
    reputationScore: '0.70',
    pollingFrequencyMinutes: 20,
  },
  {
    name: 'Ars Technica Tech Policy & AI',
    baseUrl: 'https://feeds.arstechnica.com/arstechnica/index',
    sourceType: 'rss',
    tier: 'tier_3_aggregator',
    reputationScore: '0.70',
    pollingFrequencyMinutes: 20,
  },
  {
    name: 'MIT Technology Review AI',
    baseUrl: 'https://www.technologyreview.com/topic/artificial-intelligence/feed',
    sourceType: 'rss',
    tier: 'tier_3_aggregator',
    reputationScore: '0.70',
    pollingFrequencyMinutes: 20,
  },
];

export async function seedSources(): Promise<{ inserted: number; skipped: number }> {
  const db = await getDb();
  let inserted = 0;
  let skipped = 0;

  for (const src of HIGH_SIGNAL_AI_SOURCES) {
    const existing = await db
      .select({ id: schema.sources.id })
      .from(schema.sources)
      .where(eq(schema.sources.baseUrl, src.baseUrl))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(schema.sources).values(src);
      inserted++;
    } else {
      skipped++;
    }
  }

  return { inserted, skipped };
}
