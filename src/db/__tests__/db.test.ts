import { describe, it, expect, beforeAll } from 'vitest';
import { getDb, resetDbForTesting } from '../index';
import { initializeDatabase } from '../init';
import * as schema from '../schema';
import { eq } from 'drizzle-orm';

describe('NAKSHATRA Database Schema & Layer', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  it('should initialize tables and perform CRUD on sources and raw_articles', async () => {
    const db = await getDb();

    // 1. Insert Source
    const [insertedSource] = await db
      .insert(schema.sources)
      .values({
        name: 'Anthropic Engineering Blog',
        baseUrl: 'https://www.anthropic.com/research/rss.xml',
        sourceType: 'rss',
        tier: 'tier_1_primary',
        reputationScore: '0.98',
        pollingFrequencyMinutes: 15,
      })
      .returning();

    expect(insertedSource).toBeDefined();
    expect(insertedSource.name).toBe('Anthropic Engineering Blog');
    expect(insertedSource.tier).toBe('tier_1_primary');

    // 2. Insert Raw Article
    const [insertedArticle] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: insertedSource.id,
        canonicalUrl: 'https://www.anthropic.com/news/claude-3-7-sonnet',
        title: 'Claude 3.7 Sonnet and Hybrid Reasoning',
        cleanText: 'Anthropic announces Claude 3.7 Sonnet, the first hybrid reasoning model.',
        rawContent: '<p>Anthropic announces Claude 3.7 Sonnet, the first hybrid reasoning model.</p>',
        contentHash: 'hash_test_1234567890abcdef',
        processingStatus: 'ingested',
      })
      .returning();

    expect(insertedArticle).toBeDefined();
    expect(insertedArticle.sourceId).toBe(insertedSource.id);
    expect(insertedArticle.title).toBe('Claude 3.7 Sonnet and Hybrid Reasoning');
  });

  it('should enforce verification relations: Claims, Evidences, and Articles', async () => {
    const db = await getDb();

    // 1. Create a Story Cluster
    const [cluster] = await db
      .insert(schema.storyClusters)
      .values({
        title: 'Claude 3.7 Hybrid Reasoning Launch',
        slug: 'claude-3-7-hybrid-reasoning-launch',
        summary: 'Anthropic introduces Claude 3.7 Sonnet featuring instantaneous and extended reasoning modes.',
        status: 'researching',
        velocityScore: '2.50',
      })
      .returning();

    expect(cluster).toBeDefined();

    // 2. Insert Claim
    const [claim] = await db
      .insert(schema.claims)
      .values({
        storyClusterId: cluster.id,
        claimText: 'Claude 3.7 Sonnet supports dynamic hybrid reasoning tokens.',
        claimType: 'architecture',
        verificationStatus: 'verified_primary',
        confidenceScore: '0.99',
      })
      .returning();

    expect(claim.verificationStatus).toBe('verified_primary');

    // 3. Insert Evidence
    const [evidence] = await db
      .insert(schema.evidences)
      .values({
        claimId: claim.id,
        sourceUrl: 'https://www.anthropic.com/news/claude-3-7-sonnet',
        sourceName: 'Anthropic Official Blog',
        sourceTier: 'tier_1_primary',
        verbatimExcerpt: 'Users can control how long Claude thinks before responding.',
        entailment: 'supports',
        rationale: 'Direct statement from creator blog post.',
      })
      .returning();

    expect(evidence.entailment).toBe('supports');

    // 4. Create Draft Article
    const [article] = await db
      .insert(schema.articles)
      .values({
        storyClusterId: cluster.id,
        title: 'Anthropic Unveils Claude 3.7 Sonnet with Hybrid Reasoning',
        slug: 'anthropic-unveils-claude-3-7-sonnet',
        deck: 'A new architecture combines instantaneous response with extended reasoning chains.',
        contentMarkdown: 'Anthropic has officially announced Claude 3.7 Sonnet[^1].',
        metaDescription: 'Overview of Anthropic Claude 3.7 Sonnet hybrid reasoning capabilities.',
        status: 'draft',
        confidenceScore: '0.99',
        nGramMaxSimilarity: '0.04',
        readingTimeMinutes: 2,
      })
      .returning();

    expect(article.status).toBe('draft');

    // 5. Create Citation
    const [citation] = await db
      .insert(schema.articleCitations)
      .values({
        articleId: article.id,
        claimId: claim.id,
        citationIndex: 1,
        anchorText: 'Claude 3.7 Sonnet',
        primarySourceUrl: 'https://www.anthropic.com/news/claude-3-7-sonnet',
        sourcePublisher: 'Anthropic',
      })
      .returning();

    expect(citation.citationIndex).toBe(1);
  });

  it('should track Agent Observability telemetry runs and step logs', async () => {
    const db = await getDb();

    // 1. Insert Agent Run
    const [run] = await db
      .insert(schema.agentRuns)
      .values({
        agentName: 'FactCheckAgent',
        agentVersion: '1.0.0',
        modelProvider: 'google',
        modelName: 'gemini-2.5-flash',
        promptTokens: 1250,
        completionTokens: 210,
        totalCostUsd: '0.000350',
        latencyMs: 840,
        status: 'success',
      })
      .returning();

    expect(run.agentName).toBe('FactCheckAgent');

    // 2. Insert Agent Step Log
    const [step] = await db
      .insert(schema.agentStepLogs)
      .values({
        agentRunId: run.id,
        stepNumber: 1,
        actionName: 'extract_claims',
        inputPayload: { text: 'Testing claim extraction' },
        outputPayload: { claimsCount: 1 },
        rationale: 'Extracted 1 atomic claim for verification.',
      })
      .returning();

    expect(step.actionName).toBe('extract_claims');
    expect(step.agentRunId).toBe(run.id);
  });
});
