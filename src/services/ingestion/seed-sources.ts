import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';

export const DEFAULT_AI_SOURCES = [
  {
    name: 'Google DeepMind Research',
    baseUrl: 'https://deepmind.google/discover/blog/rss.xml',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '0.99',
    pollingFrequencyMinutes: 15,
  },
  {
    name: 'Anthropic Research',
    baseUrl: 'https://www.anthropic.com/feed',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '0.99',
    pollingFrequencyMinutes: 15,
  },
  {
    name: 'OpenAI Newsroom',
    baseUrl: 'https://openai.com/news/rss.xml',
    sourceType: 'rss',
    tier: 'tier_1_primary',
    reputationScore: '0.98',
    pollingFrequencyMinutes: 15,
  },
  {
    name: 'arXiv Computer Science - Artificial Intelligence',
    baseUrl: 'https://rss.arxiv.org/rss/cs.AI',
    sourceType: 'arxiv',
    tier: 'tier_1_primary',
    reputationScore: '0.97',
    pollingFrequencyMinutes: 30,
  },
];

export async function seedDefaultSources(): Promise<void> {
  const db = await getDb();
  for (const src of DEFAULT_AI_SOURCES) {
    const existing = await db
      .select({ id: schema.sources.id })
      .from(schema.sources)
      .where(eq(schema.sources.baseUrl, src.baseUrl))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(schema.sources).values(src);
    }
  }
}
