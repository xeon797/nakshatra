import { describe, it, expect, beforeAll } from 'vitest';
import { getDb, resetDbForTesting } from '../../../db';
import { initializeDatabase } from '../../../db/init';
import * as schema from '../../../db/schema';
import { seedSources, HIGH_SIGNAL_AI_SOURCES } from '../seeds/sources';
import { eq } from 'drizzle-orm';

describe('Module 1: Database Schema Expansion & High-Signal Source Seeding', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  it('seeds all 12 initial high-signal sources with proper tiers and intervals', async () => {
    const { inserted, skipped } = await seedSources();
    expect(inserted).toBe(12);
    expect(skipped).toBe(0);

    const db = await getDb();
    const allSources = await db.select().from(schema.sources);
    expect(allSources.length).toBeGreaterThanOrEqual(12);

    // Verify Tier 1
    const tier1 = allSources.filter((s) => s.tier === 'tier_1_primary');
    expect(tier1.length).toBe(6);
    expect(tier1.every((s) => s.pollingFrequencyMinutes === 15)).toBe(true);
    expect(tier1.every((s) => s.reputationScore === '1.00')).toBe(true);

    // Verify Tier 2 (arXiv)
    const tier2 = allSources.filter((s) => s.tier === 'tier_2_verified');
    expect(tier2.length).toBe(2);
    expect(tier2.every((s) => s.pollingFrequencyMinutes === 30)).toBe(true);
    expect(tier2.every((s) => s.reputationScore === '0.90')).toBe(true);

    // Verify Tier 3 (Tech Journalism)
    const tier3 = allSources.filter((s) => s.tier === 'tier_3_aggregator');
    expect(tier3.length).toBe(4);
    expect(tier3.every((s) => s.pollingFrequencyMinutes === 20)).toBe(true);
    expect(tier3.every((s) => s.reputationScore === '0.70')).toBe(true);

    // Second run should be idempotent (0 inserted, 12 skipped)
    const secondPass = await seedSources();
    expect(secondPass.inserted).toBe(0);
    expect(secondPass.skipped).toBe(12);
  });

  it('creates and queries stories with editorial status and risk levels', async () => {
    const db = await getDb();
    const [source] = await db.select().from(schema.sources).limit(1);

    const [story] = await db
      .insert(schema.stories)
      .values({
        title: 'OpenAI Releases GPT-4.5 with Next-Gen Steerability',
        summary: 'OpenAI has officially launched GPT-4.5, targeting advanced agentic reasoning.',
        category: 'llm_release',
        editorialStatus: 'auto_approved',
        riskLevel: 'low',
        importanceScore: 92,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
        primarySourceId: source.id,
      })
      .returning();

    expect(story.id).toBeDefined();
    expect(story.title).toBe('OpenAI Releases GPT-4.5 with Next-Gen Steerability');
    expect(story.category).toBe('llm_release');
    expect(story.editorialStatus).toBe('auto_approved');
    expect(story.riskLevel).toBe('low');
    expect(story.importanceScore).toBe(92);
  });

  it('manages story_sources junction table and enforces unique constraint', async () => {
    const db = await getDb();
    const [source] = await db.select().from(schema.sources).limit(1);

    const [story] = await db
      .insert(schema.stories)
      .values({
        title: 'Claude 3.7 Sonnet Multi-Source Cluster',
        summary: 'Anthropic announcement corroborated by tech coverage.',
        category: 'research',
        editorialStatus: 'needs_review',
        riskLevel: 'medium',
        importanceScore: 85,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
      })
      .returning();

    const [rawArticle1] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: source.id,
        canonicalUrl: 'https://anthropic.com/claude-3-7-announcement',
        title: 'Claude 3.7 Sonnet Announcement',
        cleanText: 'Anthropic announces Claude 3.7 Sonnet.',
        rawContent: 'Anthropic announces Claude 3.7 Sonnet.',
        contentHash: 'hash_c37_raw1',
      })
      .returning();

    const [rawArticle2] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: source.id,
        canonicalUrl: 'https://techcrunch.com/claude-3-7-coverage',
        title: 'Anthropic launches hybrid reasoning Claude 3.7',
        cleanText: 'TechCrunch reporting on Claude 3.7 Sonnet.',
        rawContent: 'TechCrunch reporting on Claude 3.7 Sonnet.',
        contentHash: 'hash_c37_raw2',
      })
      .returning();

    // Link both raw articles to the story
    const [link1] = await db
      .insert(schema.storySources)
      .values({
        storyId: story.id,
        rawArticleId: rawArticle1.id,
        isPrimary: true,
      })
      .returning();

    const [link2] = await db
      .insert(schema.storySources)
      .values({
        storyId: story.id,
        rawArticleId: rawArticle2.id,
        isPrimary: false,
      })
      .returning();

    expect(link1.isPrimary).toBe(true);
    expect(link2.isPrimary).toBe(false);

    // Verify query
    const linkedSources = await db
      .select()
      .from(schema.storySources)
      .where(eq(schema.storySources.storyId, story.id));

    expect(linkedSources).toHaveLength(2);

    // Duplicate link should violate unique constraint
    await expect(
      db.insert(schema.storySources).values({
        storyId: story.id,
        rawArticleId: rawArticle1.id,
        isPrimary: false,
      })
    ).rejects.toThrow();
  });
});
