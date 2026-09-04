import { describe, it, expect, beforeAll } from 'vitest';
import { ClaimExtractionAgent } from '../claim-extractor';
import { FactVerificationAgent, SourceDocument } from '../fact-verifier';
import { MockAiProvider } from '../../ai/mock-provider';
import { getDb, resetDbForTesting } from '../../../db';
import { initializeDatabase } from '../../../db/init';
import * as schema from '../../../db/schema';
import { eq } from 'drizzle-orm';

describe('Feature 3: AI Research, Claim Extraction & Fact Verification Agent', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  describe('Claim Extraction Agent', () => {
    it('extracts atomic claims with source excerpts and logs telemetry', async () => {
      const mockProvider = new MockAiProvider({
        mockStructured: {
          claims: [
            {
              claimText: 'Claude 3.7 Sonnet introduces a hybrid reasoning architecture.',
              claimType: 'architecture',
              sourceExcerpt: 'Anthropic has introduced Claude 3.7 Sonnet, combining standard and extended reasoning.',
              confidenceScore: 0.98,
            },
            {
              claimText: 'The model achieves 92.4% on GSM8K in extended reasoning mode.',
              claimType: 'benchmark_result',
              sourceExcerpt: 'In extended thinking mode, Claude 3.7 scored 92.4% on the GSM8K benchmark.',
              confidenceScore: 0.95,
            },
          ],
        },
      });

      const db = await getDb();
      const [cluster] = await db
        .insert(schema.storyClusters)
        .values({
          title: 'Claude 3.7 Launch',
          slug: 'claude-3-7-launch-test',
          summary: 'Anthropic announces Claude 3.7 Sonnet.',
        })
        .returning();

      const agent = new ClaimExtractionAgent(mockProvider);
      const result = await agent.extractClaims({
        articleTitle: 'Introducing Claude 3.7 Sonnet',
        articleText: 'Anthropic has introduced Claude 3.7 Sonnet, combining standard and extended reasoning. In extended thinking mode, Claude 3.7 scored 92.4% on the GSM8K benchmark.',
        sourceName: 'Anthropic Newsroom',
        storyClusterId: cluster.id,
      });

      expect(result.claims).toHaveLength(2);
      expect(result.claims[0].claimType).toBe('architecture');
      expect(result.claims[0].sourceExcerpt).toContain('Anthropic has introduced');
      expect(result.runId).toBeDefined();

      // Verify audit run in DB
      const [run] = await db
        .select()
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.id, result.runId!));

      expect(run).toBeDefined();
      expect(run.agentName).toBe('ClaimExtractionAgent');
      expect(run.status).toBe('success');
    });
  });

  describe('Fact Verification & Entailment Engine', () => {
    it('verifies supported claims and debunks contradictory claims', async () => {
      const mockProvider = new MockAiProvider();
      const agent = new FactVerificationAgent(mockProvider);

      const sourceDoc: SourceDocument = {
        id: 'doc-1',
        url: 'https://anthropic.com/news/claude-3-7',
        sourceName: 'Anthropic Blog',
        sourceTier: 'tier_1_primary',
        text: 'Claude 3.7 Sonnet scored 92.4% on GSM8K. It requires an API subscription.',
      };

      // 1. Supported claim test
      mockProvider.setMockStructuredResponse({
        entailment: 'supports',
        verbatimExcerpt: 'Claude 3.7 Sonnet scored 92.4% on GSM8K.',
        rationale: 'Direct statement confirms the 92.4% score.',
        confidenceScore: 0.99,
      });

      const verdictSupported = await agent.verifyClaimAgainstSource({
        claimText: 'Claude 3.7 Sonnet achieved 92.4% on GSM8K.',
        source: sourceDoc,
      });

      expect(verdictSupported.entailment).toBe('supports');
      expect(verdictSupported.verbatimExcerpt).toContain('92.4%');

      // 2. Refuted claim test
      mockProvider.setMockStructuredResponse({
        entailment: 'refutes',
        verbatimExcerpt: 'It requires an API subscription.',
        rationale: 'Source explicitly states an API subscription is required, contradicting the claim that it is completely free without limits.',
        confidenceScore: 0.97,
      });

      const verdictRefuted = await agent.verifyClaimAgainstSource({
        claimText: 'Claude 3.7 Sonnet is 100% free and open without any subscription or rate limits.',
        source: sourceDoc,
      });

      expect(verdictRefuted.entailment).toBe('refutes');
    });

    it('verifies claims graph and persists claims with evidences in DB', async () => {
      const db = await getDb();
      const [cluster] = await db
        .insert(schema.storyClusters)
        .values({
          title: 'DeepSeek-R1 Paper Verification',
          slug: 'deepseek-r1-verification-test',
          summary: 'Verification of reasoning claims in DeepSeek-R1 technical report.',
        })
        .returning();

      const mockProvider = new MockAiProvider({
        mockStructured: {
          entailment: 'supports',
          verbatimExcerpt: 'DeepSeek-R1 incentives reasoning through large-scale reinforcement learning without supervised fine-tuning.',
          rationale: 'Technical report directly proves this architecture choice in Section 2.',
          confidenceScore: 0.99,
        },
      });

      const agent = new FactVerificationAgent(mockProvider);
      const sources: SourceDocument[] = [
        {
          id: 'src-deepseek',
          url: 'https://arxiv.org/abs/2501.12948',
          sourceName: 'arXiv.org',
          sourceTier: 'tier_1_primary',
          text: 'DeepSeek-R1 incentives reasoning through large-scale reinforcement learning without supervised fine-tuning.',
        },
      ];

      const outcomes = await agent.verifyClaimsGraph({
        claims: [
          {
            claimText: 'DeepSeek-R1 incentives reasoning purely via reinforcement learning.',
            claimType: 'architecture',
          },
        ],
        sources,
        storyClusterId: cluster.id,
      });

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].verificationStatus).toBe('verified_primary');
      expect(outcomes[0].evidences[0].entailment).toBe('supports');

      // Persist to DB
      const [insertedClaim] = await db
        .insert(schema.claims)
        .values({
          storyClusterId: cluster.id,
          claimText: outcomes[0].claimText,
          claimType: outcomes[0].claimType,
          verificationStatus: outcomes[0].verificationStatus,
          confidenceScore: outcomes[0].confidenceScore.toString(),
        })
        .returning();

      const [insertedEvidence] = await db
        .insert(schema.evidences)
        .values({
          claimId: insertedClaim.id,
          sourceUrl: outcomes[0].evidences[0].sourceUrl,
          sourceName: outcomes[0].evidences[0].sourceName,
          sourceTier: outcomes[0].evidences[0].sourceTier,
          verbatimExcerpt: outcomes[0].evidences[0].verbatimExcerpt,
          entailment: outcomes[0].evidences[0].entailment,
          rationale: outcomes[0].evidences[0].rationale,
        })
        .returning();

      expect(insertedClaim.id).toBeDefined();
      expect(insertedEvidence.claimId).toBe(insertedClaim.id);
      expect(insertedEvidence.entailment).toBe('supports');
    });
  });
});
