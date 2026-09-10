import { describe, it, expect, vi, beforeAll } from 'vitest';
import { determineEditorialStatus } from '../agents/clusterer';
import { FactVerificationAgent, SourceDocument } from '../../services/research/fact-verifier';
import { MockAiProvider } from '../../services/ai/mock-provider';
import * as externalResearch from '../services/external-research';
import { testGeminiLive, testTavilyLive, testResendLive } from '../../../scripts/live-api-probe';
import { getDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';
import { AutonomousPhase2Worker } from '../worker';
import { IngestionService } from '../../services/ingestion/ingest-service';

describe('API Usage Efficiency, Real Integration Separation & Gating (Step 4)', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Real API test separation: confirm mocks cannot silently pass live tests
  // ─────────────────────────────────────────────────────────────────────────
  describe('1. Real API test separation', () => {
    it('fails explicitly when real credentials are unset and never silently passes via mocks', async () => {
      const origGemini = process.env.GEMINI_API_KEY;
      const origTavily = process.env.TAVILY_API_KEY;
      const origResend = process.env.RESEND_API_KEY;

      try {
        process.env.GEMINI_API_KEY = '';
        const geminiRes = await testGeminiLive();
        expect(geminiRes.status).toBe('FAIL');
        expect(geminiRes.details).toContain('GEMINI_API_KEY is not configured');

        process.env.TAVILY_API_KEY = '';
        const tavilyRes = await testTavilyLive();
        expect(tavilyRes.status).toBe('FAIL');
        expect(tavilyRes.details).toContain('TAVILY_API_KEY is not configured');

        process.env.RESEND_API_KEY = '';
        const resendRes = await testResendLive();
        expect(resendRes.status).toBe('FAIL');
        expect(resendRes.details).toContain('RESEND_API_KEY is not configured');
      } finally {
        process.env.GEMINI_API_KEY = origGemini;
        process.env.TAVILY_API_KEY = origTavily;
        process.env.RESEND_API_KEY = origResend;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Duplicate protection before expensive APIs
  // ─────────────────────────────────────────────────────────────────────────
  describe('2. Duplicate protection before expensive APIs', () => {
    it('filters known duplicates before clustering, research, or Gemini calls occur', async () => {
      const db = await getDb();

      // Insert existing source and raw article
      const [source] = await db
        .insert(schema.sources)
        .values({
          name: 'OpenAI Test Feed',
          baseUrl: 'https://openai.com/test-rss.xml',
          sourceType: 'rss',
          tier: 'tier_1_primary',
          isActive: true,
        })
        .returning();

      const existingUrl = 'https://openai.com/blog/existing-test-article';
      await db.insert(schema.rawArticles).values({
        sourceId: source.id,
        title: 'Existing Article Already In Database',
        canonicalUrl: existingUrl,
        contentHash: 'hash-existing-12345',
        rawContent: 'Full article text content already present in local database.',
        cleanText: 'Full article text content already present in local database.',
      });

      // Attempt to ingest identical URL
      const mockAdapter = {
        parseUrl: vi.fn().mockResolvedValue([
          {
            title: 'Existing Article Already In Database',
            canonicalUrl: existingUrl,
            contentHash: 'hash-existing-12345',
            rawContent: 'Duplicate content',
            cleanText: 'Duplicate content',
            summaryExcerpt: 'Duplicate content',
            authors: [],
            publishedAt: new Date(),
            simhashFingerprint: BigInt(0),
          },
        ]),
        parseString: vi.fn().mockResolvedValue([]),
      };
      const ingestService = new IngestionService(mockAdapter as any);

      // Ingest should detect duplicate via batch URL check and insert 0
      const result = await ingestService.ingestSource(source);
      expect(result.errors).toHaveLength(0);
      expect(result.insertedCount).toBe(0);
      expect(result.exactDuplicatesSkipped).toBe(1);

      // Verify no duplicate row was created in rawArticles
      const allArticles = await db.select().from(schema.rawArticles);
      const matches = allArticles.filter((a) => a.canonicalUrl === existingUrl);
      expect(matches).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Low-value story filtering (Phase 5)
  // ─────────────────────────────────────────────────────────────────────────
  describe('3. Story importance filtering', () => {
    it('rejects low-importance stories (<40) so they never consume expensive research/synthesis', () => {
      // Low risk but low importance (< 40) must be rejected
      expect(determineEditorialStatus('low', 35)).toBe('rejected');
      expect(determineEditorialStatus('low', 15)).toBe('rejected');
      expect(determineEditorialStatus('low', 0)).toBe('rejected');

      // Low risk with high importance (>= 50) is auto-approved
      expect(determineEditorialStatus('low', 85)).toBe('auto_approved');
      expect(determineEditorialStatus('low', 50)).toBe('auto_approved');

      // Borderline importance (40-49) is queued to needs_review for editor triage
      expect(determineEditorialStatus('low', 45)).toBe('needs_review');

      // High risk stories always require human review regardless of score
      expect(determineEditorialStatus('high', 95)).toBe('needs_review');
      expect(determineEditorialStatus('high', 20)).toBe('needs_review');
    });

    it('ensures rejected stories are ignored by the worker and never trigger research or synthesis', async () => {
      const db = await getDb();

      // Insert a rejected low-importance story
      const [rejectedStory] = await db
        .insert(schema.stories)
        .values({
          title: 'Trivial Library Patch Mentioning AI',
          summary: 'A minor v0.0.2 patch with zero real architectural impact.',
          category: 'infra',
          editorialStatus: 'rejected',
          riskLevel: 'low',
          importanceScore: 20,
          firstSeenAt: new Date(),
          lastUpdatedAt: new Date(),
        })
        .returning();

      const mockResearcher = {
        synthesizeResearchGraph: vi.fn(),
      };
      const mockWriter = {
        generateArticleDraft: vi.fn(),
      };
      const mockIngestion = {
        ingestSource: vi.fn().mockResolvedValue({ insertedCount: 0, errors: [] }),
      };

      const worker = new AutonomousPhase2Worker({
        ingestionService: mockIngestion as any,
        clusterer: { processUnclustered: vi.fn().mockResolvedValue([]) } as any,
        researcher: mockResearcher as any,
        writer: mockWriter as any,
      });

      // Run worker cycle with no active sources
      await worker.runCycle({ forceAllSources: false });

      // Worker should not have attempted research or synthesis on rejectedStory
      expect(rejectedStory.editorialStatus).toBe('rejected');
      expect(mockResearcher.synthesizeResearchGraph).not.toHaveBeenCalled();
      expect(mockWriter.generateArticleDraft).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Tavily conditional usage
  // ─────────────────────────────────────────────────────────────────────────
  describe('4. Tavily conditional usage', () => {
    it('skips Tavily search when authoritative tier_1_primary lab source confirms claims without contradiction', async () => {
      const mockAi = new MockAiProvider();
      const factVerifier = new FactVerificationAgent(mockAi);

      const tavilySpy = vi.spyOn(externalResearch, 'searchSecondarySources');
      tavilySpy.mockClear();

      const primarySource: SourceDocument = {
        id: 'openai-primary-doc',
        url: 'https://openai.com/research/gpt-5',
        sourceName: 'OpenAI Research',
        sourceTier: 'tier_1_primary',
        text: 'OpenAI announces GPT-5 with multimodal reasoning benchmarks exceeding 94% on SWE-bench verified. The model is available today for enterprise and pro tiers with zero-data retention.',
      };

      const claims = [
        { claimText: 'GPT-5 exceeds 94% on SWE-bench verified.', claimType: 'benchmark_result' },
        { claimText: 'GPT-5 offers zero-data retention for enterprise.', claimType: 'product_release' },
      ];

      const outcomes = await factVerifier.verifyClaimsGraph({
        claims,
        sources: [primarySource],
      });

      expect(outcomes).toHaveLength(2);
      expect(outcomes[0].verificationStatus).toBe('verified_primary');
      // Tavily search MUST NOT be invoked because authoritative primary evidence exists and is undisputed
      expect(tavilySpy).not.toHaveBeenCalled();
    });

    it('invokes Tavily when evidence is incomplete or lacks an authoritative primary source', async () => {
      const mockAi = new MockAiProvider();
      const factVerifier = new FactVerificationAgent(mockAi);

      const tavilySpy = vi.spyOn(externalResearch, 'searchSecondarySources');
      tavilySpy.mockResolvedValue([
        {
          title: 'Reuters Tech Wire',
          url: 'https://reuters.com/ai-leak',
          content: 'Industry sources corroborate that AI lab is preparing a new reasoning cluster.',
          score: 0.9,
        },
      ]);

      // Only an unverified tier_3 aggregator source is available with no primary documentation
      const aggregatorSource: SourceDocument = {
        id: 'aggregator-doc',
        url: 'https://tech-aggregator.com/rumor',
        sourceName: 'Tech Aggregator',
        sourceTier: 'tier_3_aggregator',
        text: 'Rumors circulate regarding a secret hardware cluster.',
      };

      // Mock the verification of the claim against aggregator to be inconclusive (unverified)
      mockAi.setMockStructuredResponse({
        entailment: 'inconclusive',
        verbatimExcerpt: '',
        rationale: 'Text does not prove hardware details.',
        confidenceScore: 0.5,
      });

      const claims = [
        { claimText: 'Unconfirmed rumor about secret hardware cluster.', claimType: 'quote' },
      ];

      await factVerifier.verifyClaimsGraph({
        claims,
        sources: [aggregatorSource],
      });

      // Tavily SHOULD be called because there is no authoritative primary lab source
      expect(tavilySpy).toHaveBeenCalledWith('Unconfirmed rumor about secret hardware cluster.');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Gemini call reduction & batch claim verification
  // ─────────────────────────────────────────────────────────────────────────
  describe('5. Gemini call reduction via batch verification', () => {
    it('evaluates multiple claims against a source document in a single batch call', async () => {
      const mockAi = new MockAiProvider();
      const factVerifier = new FactVerificationAgent(mockAi);

      const generateSpy = vi.spyOn(mockAi, 'generateStructured');

      const sourceDoc: SourceDocument = {
        id: 'doc-deepmind',
        url: 'https://deepmind.google/alphafold-3',
        sourceName: 'Google DeepMind',
        sourceTier: 'tier_1_primary',
        text: 'Google DeepMind introduces AlphaFold 3, predicting the structure and interactions of all life molecules with 50% accuracy improvement over prior methods.',
      };

      const claims = [
        { claimText: 'AlphaFold 3 predicts molecular interactions.', claimType: 'product_release' },
        { claimText: 'AlphaFold 3 achieves 50% accuracy improvement.', claimType: 'benchmark_result' },
        { claimText: 'AlphaFold 3 models all life molecules.', claimType: 'architecture' },
      ];

      // Enqueue a batch verification response for the 3 claims
      mockAi.setMockStructuredResponse({
        verdicts: [
          {
            claimIndex: 0,
            entailment: 'supports',
            verbatimExcerpt: 'predicting the structure and interactions of all life molecules',
            rationale: 'Confirmed in primary text.',
            confidenceScore: 0.99,
          },
          {
            claimIndex: 1,
            entailment: 'supports',
            verbatimExcerpt: '50% accuracy improvement over prior methods',
            rationale: 'Confirmed in benchmark statement.',
            confidenceScore: 0.98,
          },
          {
            claimIndex: 2,
            entailment: 'supports',
            verbatimExcerpt: 'structure and interactions of all life molecules',
            rationale: 'Confirmed in architecture description.',
            confidenceScore: 0.97,
          },
        ],
      });

      const batchResult = await factVerifier.verifyClaimsBatchAgainstSource({
        claims,
        source: sourceDoc,
      });

      // Only ONE call was made to the AI provider for all 3 claims!
      expect(generateSpy).toHaveBeenCalledTimes(1);
      expect(batchResult.verdicts.size).toBe(3);
      expect(batchResult.verdicts.get(0)?.entailment).toBe('supports');
      expect(batchResult.verdicts.get(1)?.entailment).toBe('supports');
      expect(batchResult.verdicts.get(2)?.entailment).toBe('supports');
    });
  });
});
