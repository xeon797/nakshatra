import { describe, it, expect, beforeAll } from 'vitest';
import { PlagiarismDetector } from '../plagiarism-detector';
import {
  EditorialSynthesisAgent,
  PlagiarismGateError,
  VerifiedClaimInput,
} from '../synthesis-agent';
import { ArticleManager } from '../article-manager';
import { MockAiProvider } from '../../ai/mock-provider';
import { getDb, resetDbForTesting } from '../../../db';
import { initializeDatabase } from '../../../db/init';
import * as schema from '../../../db/schema';
import { eq } from 'drizzle-orm';

describe('Feature 4: Autonomous Editorial Synthesis & Plagiarism Gate', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  describe('N-Gram Anti-Plagiarism Quality Gate', () => {
    const rawSource = `
      OpenAI announced GPT-4.5 with advanced reasoning and improved steerability.
      The model is available immediately to all API users with standard tier quotas.
      Benchmark results indicate a 15 percent improvement on complex coding challenges.
    `;

    it('rejects near-identical verbatim scraped text', () => {
      const verbatimCopy = `
        OpenAI announced GPT-4.5 with advanced reasoning and improved steerability.
        The model is available immediately to all API users with standard tier quotas.
      `;

      const detector = new PlagiarismDetector(5, 0.12);
      const result = detector.check(verbatimCopy, [rawSource]);

      expect(result.isAcceptable).toBe(false);
      expect(result.maxSimilarity).toBeGreaterThan(0.7);
      expect(result.offendingPhrases.length).toBeGreaterThan(0);
    });

    it('accepts original analytical synthesis', () => {
      const originalSynthesis = `
        In its latest product update, OpenAI has rolled out GPT-4.5, targeting developer workflows
        that demand enhanced algorithmic reasoning and tighter instruction following.
        Early evaluations showcase double-digit performance gains on standard programming evaluations.
      `;

      const detector = new PlagiarismDetector(5, 0.12);
      const result = detector.check(originalSynthesis, [rawSource]);

      expect(result.isAcceptable).toBe(true);
      expect(result.maxSimilarity).toBeLessThan(0.12);
    });
  });

  describe('Editorial Synthesis Agent', () => {
    const verifiedClaims: VerifiedClaimInput[] = [
      {
        claimText: 'GPT-4.5 achieves a 15% improvement on coding benchmarks.',
        claimType: 'benchmark_result',
        confidenceScore: 0.99,
        primarySourceUrl: 'https://openai.com/index/gpt-4-5',
        sourcePublisher: 'OpenAI',
        verbatimExcerpt: 'Benchmark results indicate a 15 percent improvement on complex coding challenges.',
      },
    ];

    const rawSources = [
      'Benchmark results indicate a 15 percent improvement on complex coding challenges.',
    ];

    it('synthesizes grounded article draft with inline citations', async () => {
      const mockProvider = new MockAiProvider({
        mockStructured: {
          title: 'OpenAI Introduces GPT-4.5 with Coding Benchmark Gains',
          deck: 'The new model demonstrates a 15 percent lift on complex programming evaluations.',
          slug: 'openai-introduces-gpt-4-5-coding-gains',
          contentMarkdown:
            'OpenAI has officially launched its newest iteration, GPT-4.5[^1]. The release emphasizes substantial leaps in technical reasoning tasks.',
          metaDescription: 'OpenAI releases GPT-4.5 showing 15% improvement on coding benchmarks.',
          citations: [
            {
              citationIndex: 1,
              claimIndex: 0,
              anchorText: 'GPT-4.5',
              primarySourceUrl: 'https://openai.com/index/gpt-4-5',
              sourcePublisher: 'OpenAI',
            },
          ],
        },
      });

      const agent = new EditorialSynthesisAgent(mockProvider);
      const synthesis = await agent.synthesizeArticle({
        topicTitle: 'GPT-4.5 Launch',
        verifiedClaims,
        rawSourceTexts: rawSources,
      });

      expect(synthesis.draft.title).toContain('OpenAI Introduces GPT-4.5');
      expect(synthesis.draft.contentMarkdown).toContain('[^1]');
      expect(synthesis.plagiarismAudit.isAcceptable).toBe(true);
      expect(synthesis.readingTimeMinutes).toBeGreaterThanOrEqual(1);
    });

    it('blocks synthesis if draft triggers the plagiarism gate', async () => {
      // Mock returns verbatim copy of raw source
      const mockProvider = new MockAiProvider({
        mockStructured: {
          title: 'Scraped Copy',
          deck: 'Verbatim copy deck',
          slug: 'scraped-copy',
          contentMarkdown:
            'Benchmark results indicate a 15 percent improvement on complex coding challenges directly copied.',
          metaDescription: 'Scraped copy meta description.',
          citations: [
            {
              citationIndex: 1,
              claimIndex: 0,
              anchorText: 'Benchmark results',
              primarySourceUrl: 'https://openai.com/index/gpt-4-5',
              sourcePublisher: 'OpenAI',
            },
          ],
        },
      });

      const agent = new EditorialSynthesisAgent(mockProvider);
      await expect(
        agent.synthesizeArticle({
          topicTitle: 'Plagiarism Test',
          verifiedClaims,
          rawSourceTexts: rawSources,
        })
      ).rejects.toThrow(PlagiarismGateError);
    });
  });

  describe('Article Manager Lifecycle (Draft -> Approval -> Publish)', () => {
    it('manages article lifecycle in PostgreSQL with citations and revisions', async () => {
      const db = await getDb();
      const manager = new ArticleManager();

      const verifiedClaims: VerifiedClaimInput[] = [
        {
          claimText: 'Gemini 2.5 Pro integrates 2M token context window.',
          claimType: 'architecture',
          confidenceScore: 0.99,
          primarySourceUrl: 'https://deepmind.google/gemini-2-5',
          sourcePublisher: 'Google DeepMind',
          verbatimExcerpt: 'Context window expanded to 2 million tokens.',
        },
      ];

      const synthesisResult = {
        draft: {
          title: 'Google DeepMind Expands Gemini 2.5 Pro Context to 2 Million Tokens',
          deck: 'Enhanced model capacity enables seamless repository-level analysis.',
          slug: 'gemini-2-5-pro-2m-context-window',
          contentMarkdown:
            'Google DeepMind has expanded the context window of Gemini 2.5 Pro to 2 million tokens[^1].',
          metaDescription: 'Gemini 2.5 Pro now supports 2M tokens for deep code understanding.',
          citations: [
            {
              citationIndex: 1,
              claimIndex: 0,
              anchorText: 'Gemini 2.5 Pro',
              primarySourceUrl: 'https://deepmind.google/gemini-2-5',
              sourcePublisher: 'Google DeepMind',
            },
          ],
        },
        plagiarismAudit: {
          maxSimilarity: 0.04,
          isAcceptable: true,
          longestCommonPhraseLength: 2,
          offendingPhrases: [],
        },
        readingTimeMinutes: 2,
      };

      // 1. Save draft
      const draftArticle = await manager.saveDraftArticle({
        synthesisResult,
        verifiedClaims,
      });

      expect(draftArticle.id).toBeDefined();
      expect(draftArticle.status).toBe('review_pending');

      // 2. Query pending review queue
      const pendingQueue = await manager.getPendingReviewQueue();
      const foundInQueue = pendingQueue.find((a) => a.id === draftArticle.id);
      expect(foundInQueue).toBeDefined();

      // 3. Human Approval transition
      await manager.approveArticle(draftArticle.id, 'editor_alice');

      // 4. Verify public fetch by slug with citations
      const published = await manager.getArticleBySlug(draftArticle.slug);
      expect(published).not.toBeNull();
      expect(published!.status).toBe('published');
      expect(published!.publishedAt).toBeDefined();
      expect(published!.citations).toHaveLength(1);
      expect(published!.citations[0].sourcePublisher).toBe('Google DeepMind');

      // 5. Verify revision history
      const revisions = await db
        .select()
        .from(schema.articleRevisions)
        .where(eq(schema.articleRevisions.articleId, draftArticle.id));

      expect(revisions.length).toBeGreaterThanOrEqual(2);
      expect(revisions[1].editorUserId).toBe('editor_alice');
    });

    it('rejects draft with ungrounded citations (invalid claimIndex)', async () => {
      const manager = new ArticleManager();
      const verifiedClaims: VerifiedClaimInput[] = [
        {
          claimText: 'Verified claim text.',
          claimType: 'architecture',
          confidenceScore: 0.99,
          primarySourceUrl: 'https://deepmind.google',
          sourcePublisher: 'Google DeepMind',
          verbatimExcerpt: 'Excerpt',
        },
      ];

      const synthesisResultWithInvalidCitation = {
        draft: {
          title: 'Ungrounded Article',
          deck: 'Deck',
          slug: 'ungrounded-article-test',
          contentMarkdown: 'Ungrounded claim text[^1].',
          metaDescription: 'Meta',
          citations: [
            {
              citationIndex: 1,
              claimIndex: 99, // INVALID claim index out of bounds!
              anchorText: 'Invalid',
              primarySourceUrl: 'https://example.com',
              sourcePublisher: 'Unknown',
            },
          ],
        },
        plagiarismAudit: {
          maxSimilarity: 0.02,
          isAcceptable: true,
          longestCommonPhraseLength: 1,
          offendingPhrases: [],
        },
        readingTimeMinutes: 1,
      };

      await expect(
        manager.saveDraftArticle({
          synthesisResult: synthesisResultWithInvalidCitation,
          verifiedClaims,
        })
      ).rejects.toThrow(/Grounding Invariant Violation/);
    });

    it('handles slug collisions gracefully by generating unique slug suffix', async () => {
      const manager = new ArticleManager();
      const verifiedClaims: VerifiedClaimInput[] = [
        {
          claimText: 'Verified claim text.',
          claimType: 'product_release',
          confidenceScore: 0.95,
          primarySourceUrl: 'https://example.com',
          sourcePublisher: 'Example',
          verbatimExcerpt: 'Excerpt',
        },
      ];

      const baseResult = {
        draft: {
          title: 'Unique Slug Collision Test',
          deck: 'First article deck',
          slug: 'collision-test-slug',
          contentMarkdown: 'Article content 1.',
          metaDescription: 'Meta 1',
          citations: [
            {
              citationIndex: 1,
              claimIndex: 0,
              anchorText: 'Example',
              primarySourceUrl: 'https://example.com',
              sourcePublisher: 'Example',
            },
          ],
        },
        plagiarismAudit: {
          maxSimilarity: 0.01,
          isAcceptable: true,
          longestCommonPhraseLength: 1,
          offendingPhrases: [],
        },
        readingTimeMinutes: 1,
      };

      const article1 = await manager.saveDraftArticle({
        synthesisResult: baseResult,
        verifiedClaims,
      });

      const article2 = await manager.saveDraftArticle({
        synthesisResult: {
          ...baseResult,
          draft: { ...baseResult.draft, title: 'Second Article Same Slug' },
        },
        verifiedClaims,
      });

      expect(article1.slug).toBe('collision-test-slug');
      expect(article2.slug).not.toBe(article1.slug);
      expect(article2.slug).toContain('collision-test-slug-');
    });
  });
});
