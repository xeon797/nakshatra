import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as subscribeRoute } from '../../app/api/newsletter/subscribe/route';
import { NewsletterService } from '../services/newsletter-service';
import { getDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';

describe('Module 3: Newsletter Engine & Subscription System', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  it('rejects invalid email address on POST /api/newsletter/subscribe with status 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/newsletter/subscribe', {
      method: 'POST',
      body: JSON.stringify({ email: 'not-an-email', topics: ['models'] }),
    });

    const res = await subscribeRoute(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('valid email');
  });

  it('subscribes a new user with topic preferences on POST /api/newsletter/subscribe', async () => {
    const email = 'researcher@frontier-ai.org';
    const req = new NextRequest('http://localhost:3000/api/newsletter/subscribe', {
      method: 'POST',
      body: JSON.stringify({ email, topics: ['models', 'agents'] }),
    });

    const res = await subscribeRoute(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.email).toBe(email);
    expect(json.topics).toEqual(['models', 'agents']);

    // Verify in database
    const db = await getDb();
    const [subscriber] = await db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.email, email));

    expect(subscriber).toBeDefined();
    expect(subscriber.isActive).toBe(true);
    expect(subscriber.topics).toContain('models');
    expect(subscriber.topics).toContain('agents');
  });

  it('updates topics without duplicate primary key error on re-subscribing existing email', async () => {
    const email = 'researcher@frontier-ai.org';
    const req = new NextRequest('http://localhost:3000/api/newsletter/subscribe', {
      method: 'POST',
      body: JSON.stringify({ email, topics: ['all'] }),
    });

    const res = await subscribeRoute(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.topics).toEqual(['all']);

    // Check DB has exactly 1 record for this email
    const db = await getDb();
    const records = await db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.email, email));

    expect(records).toHaveLength(1);
    expect(records[0].topics).toEqual(['all']);
  });

  it('NewsletterService compiles digest payload with top story and categories', async () => {
    const db = await getDb();

    // 1. Seed a source and story with high importance score
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'OpenAI Frontier Lab',
        baseUrl: 'https://openai.com/test-newsletter-feed',
        sourceType: 'rss',
      })
      .returning();

    const [story] = await db
      .insert(schema.stories)
      .values({
        title: 'GPT-5 Breakthrough in Self-Evolving Agents',
        summary: 'Autonomous frontier agent demonstration with continuous reasoning.',
        category: 'agentic',
        editorialStatus: 'published',
        riskLevel: 'low',
        importanceScore: 98,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
        primarySourceId: source.id,
      })
      .returning();

    const [article] = await db
      .insert(schema.articles)
      .values({
        storyId: story.id,
        title: 'GPT-5 Breakthrough in Self-Evolving Agents',
        slug: 'gpt-5-breakthrough-self-evolving-agents',
        deck: 'Autonomous frontier agent demonstration with continuous reasoning.',
        contentMarkdown: 'Full verified report on self-evolving agents [^1].',
        metaDescription: 'Frontier AI autonomous agents analysis.',
        status: 'published',
        publishedAt: new Date(),
        readingTimeMinutes: 4,
      })
      .returning();

    await db.insert(schema.articleCitations).values({
      articleId: article.id,
      citationIndex: 1,
      anchorText: 'self-evolving agents',
      primarySourceUrl: 'https://openai.com/research/gpt-5-agents',
      sourcePublisher: 'OpenAI',
    });

    const newsletterService = new NewsletterService();
    const payload = await newsletterService.compileDigestPayload(48);

    expect(payload.dateStr).toBeDefined();
    expect(payload.topStory).toBeDefined();
    expect(payload.topStory?.title).toContain('GPT-5');
    expect(payload.topStory?.sourceNames).toContain('OpenAI');
  });

  it('NewsletterService sends daily digest to active subscribers matching topics in safe mock mode', async () => {
    const db = await getDb();
    const testSubEmail = 'vip-subscriber@enterprise.com';

    await db
      .insert(schema.subscribers)
      .values({
        email: testSubEmail,
        topics: ['all'],
        isActive: true,
      })
      .onConflictDoNothing();

    const newsletterService = new NewsletterService();
    const result = await newsletterService.sendDailyDigest({ lookbackHours: 48 });

    expect(result.success).toBe(true);
    expect(result.mockMode).toBe(true);
    expect(result.subscribersMatched).toBeGreaterThanOrEqual(1);
    expect(result.emailsSent).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
  });
});
