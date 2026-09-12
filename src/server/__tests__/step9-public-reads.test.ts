import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '../../db';
import * as initialization from '../../db/init';
import * as schema from '../../db/schema';
import { ArticleManager } from '../../services/editorial/article-manager';
import { getAiProvider } from '../../services/ai/factory';
import { GET } from '../../app/api/articles/route';

describe('Production public reads', () => {
  beforeEach(async () => {
    await closeDb();
    await initialization.initializeDatabase();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await closeDb();
  });

  it('reads twelve articles with bounded metadata queries and preserves citation fallback', async () => {
    const db = await getDb();
    const [source] = await db.insert(schema.sources).values({ name: 'Primary Lab', baseUrl: 'https://example.com/feed' }).returning();
    const [story] = await db.insert(schema.stories).values({ title: 'Linked story', summary: 'Summary', category: 'research', riskLevel: 'low', importanceScore: 75, firstSeenAt: new Date(), lastUpdatedAt: new Date() }).returning();
    const [raw] = await db.insert(schema.rawArticles).values({ sourceId: source.id, canonicalUrl: 'https://example.com/story', title: 'Source article', rawContent: 'Evidence', cleanText: 'Evidence', contentHash: 'test-hash' }).returning();
    await db.insert(schema.storySources).values({ storyId: story.id, rawArticleId: raw.id, isPrimary: true });
    for (let i = 0; i < 12; i++) {
      const [article] = await db.insert(schema.articles).values({ storyId: i === 0 ? story.id : null, title: `Article ${i}`, slug: `article-${i}`, deck: 'Summary', contentMarkdown: 'Body', metaDescription: 'Description', status: 'published', publishedAt: new Date(2026, 0, i + 1) }).returning();
      if (i > 0) await db.insert(schema.articleCitations).values({ articleId: article.id, citationIndex: 1, anchorText: 'Evidence', primarySourceUrl: 'https://example.com/evidence', sourcePublisher: 'Citation Publisher' });
    }
    const select = vi.spyOn(db, 'select');
    const rows = await new ArticleManager().getPublishedArticlesWithMetadata(12);
    expect(select).toHaveBeenCalledTimes(3);
    expect(rows).toHaveLength(12);
    expect(rows.find(a => a.slug === 'article-0')?.sources).toEqual([{ name: 'Primary Lab', tier: source.tier, isPrimary: true }]);
    expect(rows.find(a => a.slug === 'article-1')?.sources[0].name).toBe('Citation Publisher');
    const initialize = vi.spyOn(initialization, 'ensureDatabaseInitialized').mockRejectedValue(new Error('Public reads must not initialize the database'));
    const response = await GET(new Request('http://localhost/api/articles?offset=12&limit=12'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ articles: [], pagination: { total: 12, hasMore: false } });
    expect(initialize).not.toHaveBeenCalled();
  });

  it('rejects malformed offsets before accessing the database', async () => {
    const response = await GET(new Request('http://localhost/api/articles?offset=NaN'));
    expect(response.status).toBe(400);
  });

  it('fails closed when production database or Gemini configuration is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    await expect(getDb()).rejects.toThrow('PGlite fallback is disabled');
    expect(() => getAiProvider()).toThrow('Mock AI fallback is disabled');
  });
});
