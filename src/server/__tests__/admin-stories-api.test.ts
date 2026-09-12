import { describe, it, expect, beforeAll } from 'vitest';
import { GET } from '../../app/api/admin/stories/route';
import { POST as promoteStory } from '../../app/api/admin/stories/[id]/promote/route';
import { NextRequest } from 'next/server';
import { getDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';
import { getAdminSecret } from '../../lib/auth';
import { eq } from 'drizzle-orm';

describe('Module 3: Admin Review API Routes', () => {
  beforeAll(async () => {
    process.env.ADMIN_API_SECRET = 'test-admin-secret-2026';
    resetDbForTesting();
    await initializeDatabase();
  });

  it('rejects unauthenticated requests without ADMIN_API_SECRET', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/stories');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns pending review stories with linked sources when authenticated', async () => {
    const db = await getDb();
    const adminSecret = getAdminSecret();

    // 1. Insert source and raw article
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'Anthropic Research',
        baseUrl: 'https://anthropic.com/test-api-feed',
        sourceType: 'rss',
      })
      .returning();

    const [story] = await db
      .insert(schema.stories)
      .values({
        title: 'Claude 3.7 Hybrid Reasoning Benchmarks',
        summary: 'Competitive reasoning analysis requiring human editor review.',
        category: 'research',
        editorialStatus: 'needs_review',
        riskLevel: 'medium',
        importanceScore: 84,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
        primarySourceId: source.id,
      })
      .returning();

    const [rawArticle] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: source.id,
        canonicalUrl: 'https://anthropic.com/claude-3-7-benchmarks',
        title: 'Claude 3.7 Benchmarks',
        cleanText: 'Anthropic benchmark data for Claude 3.7.',
        rawContent: 'Anthropic benchmark data.',
        contentHash: 'hash_api_test_raw1',
      })
      .returning();

    await db.insert(schema.storySources).values({
      storyId: story.id,
      rawArticleId: rawArticle.id,
      isPrimary: true,
    });

    // 2. Call GET /api/admin/stories with ADMIN_API_SECRET header
    const req = new NextRequest('http://localhost:3000/api/admin/stories?status=needs_review', {
      headers: {
        'admin_api_secret': adminSecret,
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.count).toBeGreaterThanOrEqual(1);

    const targetStory = json.stories.find((s: any) => s.id === story.id);
    expect(targetStory).toBeDefined();
    expect(targetStory.title).toContain('Claude 3.7');
    expect(targetStory.riskLevel).toBe('medium');
    expect(targetStory.sources).toHaveLength(1);
    expect(targetStory.sources[0].sourceName).toBe('Anthropic Research');
  });

  it('promotes pending story to auto_approved and dispatches article synthesis on POST /promote', async () => {
    const db = await getDb();
    const adminSecret = getAdminSecret();

    // 1. Create a story needing review
    const [source] = await db.select().from(schema.sources).limit(1);

    const [pendingStory] = await db
      .insert(schema.stories)
      .values({
        title: 'DeepSeek R1 Architecture Breakdown',
        summary: 'DeepSeek reasoning paper breakdown.',
        category: 'research',
        editorialStatus: 'needs_review',
        riskLevel: 'medium',
        importanceScore: 88,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
        primarySourceId: source.id,
      })
      .returning();

    const [raw] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: source.id,
        canonicalUrl: 'https://deepseek.com/r1-paper-breakdown',
        title: 'DeepSeek-R1 Technical Overview',
        cleanText: 'DeepSeek-R1 leverages pure reinforcement learning without supervised warm-up.',
        rawContent: 'DeepSeek-R1 leverages pure reinforcement learning.',
        contentHash: 'hash_promote_raw1',
      })
      .returning();

    await db.insert(schema.storySources).values({
      storyId: pendingStory.id,
      rawArticleId: raw.id,
      isPrimary: true,
    });

    // 2. Call POST /api/admin/stories/[id]/promote
    const req = new NextRequest(`http://localhost:3000/api/admin/stories/${pendingStory.id}/promote`, {
      method: 'POST',
      headers: {
        'admin_api_secret': adminSecret,
      },
    });

    const res = await promoteStory(req, { params: Promise.resolve({ id: pendingStory.id }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.storyId).toBe(pendingStory.id);
    expect(json.articleId).toBeDefined();

    // Verify DB story state was updated
    const [promotedStory] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, pendingStory.id));

    expect(promotedStory.editorialStatus).toBe('published');
  });
});
