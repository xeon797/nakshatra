import { describe, it, expect, beforeAll } from 'vitest';
import { AutonomousNewsroomOrchestrator } from '../orchestrator';
import { MockAiProvider } from '../ai/mock-provider';
import { getDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';

describe('End-to-End Autonomous Pipeline Orchestrator', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  it('runs complete autonomous cycle: Ingestion -> Claims -> Verification -> Synthesis -> Draft Article', async () => {
    const db = await getDb();

    // 1. Create primary source
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: 'Google DeepMind Blog',
        baseUrl: 'https://deepmind.google/blog/rss-e2e.xml',
        sourceType: 'rss',
        tier: 'tier_1_primary',
        reputationScore: '0.99',
      })
      .returning();

    const sampleRssXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Google DeepMind</title>
          <link>https://deepmind.google</link>
          <item>
            <title>AlphaGeometry 2 Breakthrough</title>
            <link>https://deepmind.google/research/alphageometry-2-e2e</link>
            <description>AlphaGeometry 2 solves 83% of all International Mathematical Olympiad geometry problems.</description>
          </item>
        </channel>
      </rss>`;

    const mockProvider = new MockAiProvider();

    // Queue 1: Extraction Agent
    mockProvider.enqueueStructuredResponse({
      claims: [
        {
          claimText: 'AlphaGeometry 2 solves 83% of IMO geometry problems.',
          claimType: 'benchmark_result',
          sourceExcerpt: 'AlphaGeometry 2 solves 83% of all International Mathematical Olympiad geometry problems.',
          confidenceScore: 0.99,
        },
      ],
    });

    // Queue 2: Fact Verification Agent
    mockProvider.enqueueStructuredResponse({
      entailment: 'supports',
      verbatimExcerpt: 'AlphaGeometry 2 solves 83% of all International Mathematical Olympiad geometry problems.',
      rationale: 'Source text explicitly states the 83% benchmark resolution.',
      confidenceScore: 0.99,
    });

    // Queue 3: Editorial Synthesis Agent
    mockProvider.enqueueStructuredResponse({
      title: 'DeepMind Unveils AlphaGeometry 2 with 83% Olympiad Geometry Mastery',
      deck: 'A hybrid neuro-symbolic engine achieves unprecedented mathematical problem-solving benchmarks.',
      slug: 'deepmind-unveils-alphageometry-2-olympiad-benchmarks',
      contentMarkdown:
        'Google DeepMind has introduced AlphaGeometry 2, an AI system capable of solving 83 percent of International Mathematical Olympiad geometry challenges[^1]. The breakthrough demonstrates significant progress in automated formal reasoning.',
      metaDescription: 'DeepMind AlphaGeometry 2 solves 83% of Olympiad geometry problems.',
      citations: [
        {
          citationIndex: 1,
          claimIndex: 0,
          anchorText: 'AlphaGeometry 2',
          primarySourceUrl: 'https://deepmind.google/research/alphageometry-2-e2e',
          sourcePublisher: 'Google DeepMind Blog',
        },
      ],
    });

    const orchestrator = new AutonomousNewsroomOrchestrator(mockProvider);

    // Run pipeline
    const report = await orchestrator.processSource(source.id, sampleRssXml);

    expect(report.sourceName).toBe('Google DeepMind Blog');
    expect(report.articlesIngested).toBe(1);
    expect(report.draftsGenerated).toBe(1);
    expect(report.failures).toHaveLength(0);

    // Verify that draft article was created in DB
    const drafts = await db
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.status, 'review_pending'));

    expect(drafts.length).toBeGreaterThanOrEqual(1);
    const draft = drafts[0];
    expect(draft.title).toContain('AlphaGeometry 2');
    expect(draft.status).toBe('review_pending');

    // Verify citations exist
    const citations = await db
      .select()
      .from(schema.articleCitations)
      .where(eq(schema.articleCitations.articleId, draft.id));

    expect(citations.length).toBeGreaterThanOrEqual(1);
    expect(citations[0].anchorText).toBe('AlphaGeometry 2');

    // Verify agent runs were logged for observability
    const runs = await db.select().from(schema.agentRuns);
    expect(runs.length).toBeGreaterThanOrEqual(3); // extraction + verification + synthesis
  });
});
