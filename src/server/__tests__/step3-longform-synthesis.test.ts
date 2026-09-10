import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  MultiSourceResearcherAgent,
  isOfficialLabOrTier1,
  buildStructuredEvidence,
  EvidencePacket,
} from '../agents/researcher';
import { MultiSourceWriterAgent } from '../agents/writer';
import {
  buildSynthesisPrompts,
  sanitizeAndGroundCitations,
  remapAndGroundCitations,
  GroundingValidationError,
  BilingualParityError,
  validateBilingualParity,
  validateEpistemicSeparation,
  getCategoryEditorialTemplate,
  CATEGORY_EDITORIAL_TEMPLATES,
  normalizeVerifiedClaim,
  VerifiedClaimInput,
} from '../../services/editorial/synthesis-agent';
import { MockAiProvider } from '../../services/ai/mock-provider';
import { getDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';
import * as externalResearch from '../services/external-research';

describe('STEP 3 — Article Evidence & Long-Form Synthesis Pipeline', () => {
  beforeAll(async () => {
    resetDbForTesting();
    await initializeDatabase();
  });

  describe('1. Evidence Layer: Source Prioritization & Deep Extraction', () => {
    it('correctly prioritizes official lab announcements over aggregators', () => {
      const tier1Official = {
        sourceTier: 'tier_1_primary',
        url: 'https://openai.com/index/gpt-4-5',
        sourceName: 'OpenAI Newsroom',
      };
      const aggregator = {
        sourceTier: 'tier_3_aggregator',
        url: 'https://techcrunch.com/article',
        sourceName: 'TechCrunch AI',
      };
      const arxivPaper = {
        sourceTier: 'tier_2_verified',
        url: 'https://arxiv.org/abs/2502.12345',
        sourceName: 'arXiv Computer Science',
      };

      expect(isOfficialLabOrTier1(tier1Official)).toBe(true);
      expect(isOfficialLabOrTier1(arxivPaper)).toBe(true);
      expect(isOfficialLabOrTier1(aggregator)).toBe(false);
    });

    it('triggers Jina Reader enrichment when source text is shallow (< 2000 chars)', async () => {
      const db = await getDb();

      const [source] = await db
        .insert(schema.sources)
        .values({
          name: 'Anthropic Research',
          baseUrl: 'https://anthropic.com/feed.xml',
          sourceType: 'rss',
          tier: 'tier_1_primary',
        })
        .returning();

      const [story] = await db
        .insert(schema.stories)
        .values({
          title: 'Claude 3.7 Extended Thinking Released',
          summary: 'Anthropic releases hybrid reasoning model with adjustable thinking tokens.',
          category: 'research',
          editorialStatus: 'auto_approved',
          riskLevel: 'low',
          importanceScore: 94,
          firstSeenAt: new Date(),
          lastUpdatedAt: new Date(),
          primarySourceId: source.id,
        })
        .returning();

      // Short teaser snippet (350 chars)
      const shortSnippet = 'Anthropic has announced Claude 3.7 Sonnet, introducing hybrid reasoning architecture allowing users to calibrate thinking budgets between instant response and extended chain-of-thought analysis.';

      const [rawArticle] = await db
        .insert(schema.rawArticles)
        .values({
          sourceId: source.id,
          canonicalUrl: 'https://anthropic.com/news/claude-3-7-sonnet',
          title: 'Claude 3.7 Sonnet and Claude Code',
          cleanText: shortSnippet,
          rawContent: shortSnippet,
          contentHash: 'hash_step3_deep_extract_test',
        })
        .returning();

      await db.insert(schema.storySources).values({
        storyId: story.id,
        rawArticleId: rawArticle.id,
        isPrimary: true,
      });

      // Spy on extractCleanMarkdown
      const fullArticleMarkdown = `# Claude 3.7 Sonnet Release
Anthropic has announced Claude 3.7 Sonnet, the industry's first hybrid reasoning model.
## Technical Specifications
Claude 3.7 Sonnet combines instant response capabilities with a fine-grained reasoning token budget up to 128K tokens. The architecture uses continuous pretraining with reinforcement learning from verifiable rewards.
## Benchmarks
On SWE-bench Verified, Claude 3.7 Sonnet achieves 70.3%, outperforming previous frontier systems.
## Safety and Guardrails
Anthropic evaluated the model against catastrophic risks under its Responsible Scaling Policy (ASL-2).`;

      const extractSpy = vi
        .spyOn(externalResearch, 'extractCleanMarkdown')
        .mockResolvedValueOnce(fullArticleMarkdown);

      const mockProvider = new MockAiProvider();
      // Enqueue claim extraction response
      mockProvider.enqueueStructuredResponse({
        claims: [
          {
            claimText: 'Claude 3.7 Sonnet introduces hybrid reasoning with adjustable thinking budget.',
            claimType: 'product_release',
            sourceExcerpt: 'Anthropic has announced Claude 3.7 Sonnet, the industry\'s first hybrid reasoning model.',
            confidenceScore: 0.99,
          },
          {
            claimText: 'Claude 3.7 Sonnet achieves 70.3% on SWE-bench Verified.',
            claimType: 'benchmark_result',
            sourceExcerpt: 'On SWE-bench Verified, Claude 3.7 Sonnet achieves 70.3%.',
            confidenceScore: 0.98,
          },
        ],
      });

      // Enqueue fact verification responses
      mockProvider.enqueueStructuredResponse({
        entailment: 'supports',
        verbatimExcerpt: 'Anthropic has announced Claude 3.7 Sonnet, the industry\'s first hybrid reasoning model.',
        rationale: 'Source confirms release directly.',
        confidenceScore: 0.99,
      });
      mockProvider.enqueueStructuredResponse({
        entailment: 'supports',
        verbatimExcerpt: 'On SWE-bench Verified, Claude 3.7 Sonnet achieves 70.3%.',
        rationale: 'SWE-bench metric directly verified.',
        confidenceScore: 0.98,
      });

      const researcher = new MultiSourceResearcherAgent(mockProvider);
      const packet = await researcher.buildEvidencePacket(story.id);

      expect(extractSpy).toHaveBeenCalledWith(
        'https://anthropic.com/news/claude-3-7-sonnet',
        shortSnippet
      );
      expect(packet.primarySources[0].text).toBe(fullArticleMarkdown);
      expect(packet.confirmedFacts.length).toBeGreaterThanOrEqual(2);
      expect(packet.structuredDetails).toBeDefined();
      expect(packet.structuredDetails?.benchmarksAndResults).toContain(
        'Claude 3.7 Sonnet achieves 70.3% on SWE-bench Verified.'
      );

      extractSpy.mockRestore();
    });

    it('gracefully falls back to RSS text when Jina Reader fails without throwing', async () => {
      const db = await getDb();

      const [source] = await db
        .insert(schema.sources)
        .values({
          name: 'OpenAI Blog',
          baseUrl: 'https://openai.com/blog-feed.xml',
          sourceType: 'rss',
          tier: 'tier_1_primary',
        })
        .returning();

      const [story] = await db
        .insert(schema.stories)
        .values({
          title: 'OpenAI Releases Sora Preview',
          summary: 'Video generation model released to red-teamers and artists.',
          category: 'multimodal',
          editorialStatus: 'auto_approved',
          riskLevel: 'low',
          importanceScore: 88,
          firstSeenAt: new Date(),
          lastUpdatedAt: new Date(),
          primarySourceId: source.id,
        })
        .returning();

      const rssSnippet = 'OpenAI announces Sora, an AI model that can create realistic and imaginative video scenes from text instructions.';

      const [rawArticle] = await db
        .insert(schema.rawArticles)
        .values({
          sourceId: source.id,
          canonicalUrl: 'https://openai.com/index/sora-timeout-test',
          title: 'Sora Video Generation',
          cleanText: rssSnippet,
          rawContent: rssSnippet,
          contentHash: 'hash_step3_fallback_test',
        })
        .returning();

      await db.insert(schema.storySources).values({
        storyId: story.id,
        rawArticleId: rawArticle.id,
        isPrimary: true,
      });

      // Mock Jina Reader throwing network timeout
      const extractSpy = vi
        .spyOn(externalResearch, 'extractCleanMarkdown')
        .mockRejectedValueOnce(new Error('ETIMEDOUT: Connection to r.jina.ai timed out'));

      const mockProvider = new MockAiProvider();
      mockProvider.enqueueStructuredResponse({
        claims: [
          {
            claimText: 'OpenAI announces Sora video generation model.',
            claimType: 'product_release',
            sourceExcerpt: rssSnippet,
            confidenceScore: 0.95,
          },
        ],
      });
      mockProvider.enqueueStructuredResponse({
        entailment: 'supports',
        verbatimExcerpt: rssSnippet,
        rationale: 'Confirmed from RSS description.',
        confidenceScore: 0.95,
      });

      const researcher = new MultiSourceResearcherAgent(mockProvider);
      // Must not throw even when Jina network fails
      const packet = await researcher.buildEvidencePacket(story.id);

      expect(packet.primarySources[0].text).toBe(rssSnippet);
      expect(packet.primarySources[0].extractionStatus).toBe('fallback_rss');
      expect(packet.primarySources[0].retrievalStatus).toBe('fallback');
      expect(packet.primarySources[0].provenance).toContain('RSS feed fallback');
      expect(packet.confirmedFacts.length).toBeGreaterThanOrEqual(1);

      extractSpy.mockRestore();
    });

    it('triggers Jina Reader extraction on canonical primary URLs even when RSS text is long (> 2000 chars)', async () => {
      const db = await getDb();

      const [source] = await db
        .insert(schema.sources)
        .values({
          name: 'DeepMind Research',
          baseUrl: 'https://deepmind.google/blog/feed.xml',
          sourceType: 'rss',
          tier: 'tier_1_primary',
        })
        .returning();

      const [story] = await db
        .insert(schema.stories)
        .values({
          title: 'AlphaProof Solves Olympiad Problems',
          summary: 'Formal reasoning system solves IMO problems.',
          category: 'research',
          editorialStatus: 'auto_approved',
          riskLevel: 'low',
          importanceScore: 98,
          firstSeenAt: new Date(),
          lastUpdatedAt: new Date(),
          primarySourceId: source.id,
        })
        .returning();

      // Long RSS snippet (> 2000 chars)
      const longRssText = 'Google DeepMind announces AlphaProof. '.repeat(65); // ~2470 chars
      expect(longRssText.length).toBeGreaterThan(2000);

      const [rawArticle] = await db
        .insert(schema.rawArticles)
        .values({
          sourceId: source.id,
          canonicalUrl: 'https://deepmind.google/discover/blog/ai-solves-imo-problems-alphaproof',
          title: 'AI Solves IMO Problems with AlphaProof',
          cleanText: longRssText,
          rawContent: longRssText,
          contentHash: 'hash_step3_long_rss_test',
        })
        .returning();

      await db.insert(schema.storySources).values({
        storyId: story.id,
        rawArticleId: rawArticle.id,
        isPrimary: true,
      });

      const extractedJinaMarkdown = `# AlphaProof: Solving Mathematical Olympiad Problems with Formal Reasoning
Google DeepMind introduces AlphaProof, a breakthrough system that bridges informal reasoning with formal mathematical verification in Lean.`;

      const extractSpy = vi
        .spyOn(externalResearch, 'extractCleanMarkdown')
        .mockResolvedValueOnce(extractedJinaMarkdown);

      const mockProvider = new MockAiProvider();
      mockProvider.enqueueStructuredResponse({
        claims: [
          {
            claimText: 'AlphaProof solves silver-medal level International Mathematical Olympiad problems.',
            claimType: 'benchmark_result',
            sourceExcerpt: 'system solves IMO problems.',
            confidenceScore: 0.99,
          },
        ],
      });
      mockProvider.enqueueStructuredResponse({
        entailment: 'supports',
        verbatimExcerpt: 'system solves IMO problems.',
        rationale: 'Confirmed from extraction.',
        confidenceScore: 0.99,
      });

      const researcher = new MultiSourceResearcherAgent(mockProvider);
      const packet = await researcher.buildEvidencePacket(story.id);

      // Must call extractCleanMarkdown despite RSS description exceeding 2000 chars!
      expect(extractSpy).toHaveBeenCalledWith(
        'https://deepmind.google/discover/blog/ai-solves-imo-problems-alphaproof',
        longRssText
      );
      expect(packet.primarySources[0].text).toBe(extractedJinaMarkdown);
      expect(packet.primarySources[0].extractionStatus).toBe('jina_extracted');
      expect(packet.primarySources[0].retrievalStatus).toBe('success');
      expect(packet.primarySources[0].provenance).toContain('Jina Reader extracted');

      // Check claim-level provenance fields
      expect(packet.verifiedClaimsList).toBeDefined();
      expect(packet.verifiedClaimsList!.length).toBeGreaterThanOrEqual(1);
      const claim = packet.verifiedClaimsList![0];
      expect(claim.claimId).toBeDefined();
      expect(claim.claimText).toBe('AlphaProof solves silver-medal level International Mathematical Olympiad problems.');
      expect(claim.sourceUrl).toBe('https://deepmind.google/discover/blog/ai-solves-imo-problems-alphaproof');
      expect(claim.sourceTitle).toBe('DeepMind Research');
      expect(claim.sourceType).toBe('tier_1_primary');
      expect(claim.evidenceExcerpt).toBeDefined();
      expect(claim.epistemicClass).toBeDefined();

      extractSpy.mockRestore();
    });
  });

  describe('2. Structured Evidence Dossier Assembly', () => {
    it('assembles rich multi-section structured evidence from claims and text', () => {
      const primarySource = {
        title: 'DeepMind AlphaFold 3 Advances Molecular Biology',
        url: 'https://deepmind.google/alphafold-3',
        text: 'Google DeepMind announces AlphaFold 3. The architecture uses a diffusion module to predict all life molecules with high accuracy. On the PoseBusters benchmark, accuracy improved by 50% over existing models. DeepMind collaborated with Isomorphic Labs for drug design.',
        sourceName: 'Google DeepMind',
        sourceTier: 'tier_1_primary',
      };

      const verifiedClaims = [
        {
          claimText: 'DeepMind introduces AlphaFold 3 for biomolecular structure prediction.',
          claimType: 'product_release',
          isPrimary: true,
          isConfirmed: true,
        },
        {
          claimText: 'AlphaFold 3 utilizes a diffusion-based module to model atom coordinates directly.',
          claimType: 'architecture',
          isPrimary: true,
          isConfirmed: true,
        },
        {
          claimText: 'AlphaFold 3 achieves 50% higher accuracy on PoseBusters benchmark.',
          claimType: 'benchmark_result',
          isPrimary: true,
          isConfirmed: true,
        },
        {
          claimText: 'Access is provided via AlphaFold Server with non-commercial license constraints.',
          claimType: 'policy_or_safety',
          isPrimary: true,
          isConfirmed: true,
        },
      ];

      const structured = buildStructuredEvidence({
        storyTitle: 'DeepMind Releases AlphaFold 3',
        primarySources: [primarySource],
        secondarySources: [],
        verifiedClaimsWithTypes: verifiedClaims,
        differingPerspectives: ['Researchers question closed code availability.'],
      });

      expect(structured.whatHappened).toContain('AlphaFold 3');
      expect(structured.technicalDetails).toContain('diffusion-based module');
      expect(structured.benchmarksAndResults).toContain(
        'AlphaFold 3 achieves 50% higher accuracy on PoseBusters benchmark.'
      );
      expect(structured.limitationsAndCaveats).toContain(
        'Access is provided via AlphaFold Server with non-commercial license constraints.'
      );
      expect(structured.backgroundAndContext).toContain('closed code availability');
      expect(structured.industrySignificance).toBeDefined();
    });
  });

  describe('3. Citation Grounding & Sanitization Guard', () => {
    it('sanitizes, deterministically remaps, and strips ungrounded citation tokens without defaulting to claim[0]', () => {
      const verifiedClaims: VerifiedClaimInput[] = [
        {
          claimText: 'Llama 3.3 70B matches previous 405B capabilities on MMLU.',
          claimType: 'benchmark_result',
          confidenceScore: 0.98,
          primarySourceUrl: 'https://ai.meta.com/llama-3-3',
          sourcePublisher: 'Meta AI',
          verbatimExcerpt: 'Llama 3.3 70B matches Llama 3.1 405B on key evaluations.',
        },
      ];

      // Citation 1 matches claim 0. Citation 2 references non-existent claim 5 with no matching URL/anchorText.
      const rawCitations = [
        {
          citationIndex: 1,
          claimIndex: 0,
          anchorText: 'Llama 3.3',
          primarySourceUrl: 'https://ai.meta.com/llama-3-3',
          sourcePublisher: 'Meta AI',
        },
        {
          citationIndex: 2,
          claimIndex: 5, // Invalid claim index!
          anchorText: 'Completely ungrounded claim',
          primarySourceUrl: 'https://unrelated-site.com/fake',
          sourcePublisher: 'Unknown Hallucination',
        },
      ];

      const sampleEnText = 'Llama 3.3 was released[^1]. It possesses magical capabilities[^2].';
      const result = remapAndGroundCitations({
        rawCitations,
        claims: verifiedClaims,
        enContent: sampleEnText,
      });

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].claimIndex).toBe(0);
      expect(result.citations[0].sourcePublisher).toBe('Meta AI');
      // Token [^2] must be stripped from the article text
      expect(result.enContent).toContain('released[^1]');
      expect(result.enContent).not.toContain('[^2]');
      expect(result.unmappedIndices).toContain(2);
    });

    it('deterministically remaps citation when claimIndex is out of bounds but source URL matches verified evidence', () => {
      const verifiedClaims: VerifiedClaimInput[] = [
        {
          claimText: 'DeepSeek-V3 introduces Multi-head Latent Attention.',
          claimType: 'architecture',
          confidenceScore: 0.99,
          primarySourceUrl: 'https://github.com/deepseek-ai/DeepSeek-V3',
          sourcePublisher: 'DeepSeek AI',
          verbatimExcerpt: 'DeepSeek-V3 adopts Multi-head Latent Attention.',
        },
      ];

      // LLM mistakenly provided claimIndex: 99, but provided the exact source URL
      const rawCitations = [
        {
          citationIndex: 1,
          claimIndex: 99,
          anchorText: 'Multi-head Latent Attention',
          primarySourceUrl: 'https://github.com/deepseek-ai/DeepSeek-V3',
          sourcePublisher: 'DeepSeek AI',
        },
      ];

      const result = remapAndGroundCitations({
        rawCitations,
        claims: verifiedClaims,
      });

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].claimIndex).toBe(0);
      expect(result.citations[0].sourcePublisher).toBe('DeepSeek AI');
    });

    it('never defaults to claim[0] and fails validation with GroundingValidationError when citations array is empty', () => {
      const verifiedClaims: VerifiedClaimInput[] = [
        {
          claimText: 'Mistral releases Large 2 with 128k context.',
          claimType: 'product_release',
          confidenceScore: 0.95,
          primarySourceUrl: 'https://mistral.ai/news/mistral-large-2',
          sourcePublisher: 'Mistral AI',
          verbatimExcerpt: 'Mistral Large 2 released with 128k context.',
        },
      ];

      // Must never invent claim[0] — throws GroundingValidationError!
      expect(() => sanitizeAndGroundCitations([], verifiedClaims)).toThrow(GroundingValidationError);
      expect(() =>
        remapAndGroundCitations({
          rawCitations: [],
          claims: verifiedClaims,
        })
      ).toThrow(GroundingValidationError);
    });

    it('fails validation with GroundingValidationError when all citations are ungrounded and 0 valid citations remain', () => {
      const verifiedClaims: VerifiedClaimInput[] = [
        {
          claimText: 'Claude 3.7 Sonnet combines instant and thinking tokens.',
          claimType: 'architecture',
          confidenceScore: 0.98,
          primarySourceUrl: 'https://anthropic.com/claude-3-7',
          sourcePublisher: 'Anthropic',
          verbatimExcerpt: 'Claude 3.7 Sonnet combines instant and thinking tokens.',
        },
      ];

      const bogusCitations = [
        {
          citationIndex: 1,
          claimIndex: 88,
          anchorText: 'Completely unverified speculation',
          primarySourceUrl: 'https://fake-news.xyz/unverified',
          sourcePublisher: 'Fake Site',
        },
      ];

      expect(() =>
        remapAndGroundCitations({
          rawCitations: bogusCitations,
          claims: verifiedClaims,
        })
      ).toThrow(GroundingValidationError);
    });
  });

  describe('4. Long-Form Editorial Synthesis Prompt Structure', () => {
    it('constructs prompt with target 600-1200 words and full technical section layout', () => {
      const verifiedClaims: VerifiedClaimInput[] = [
        {
          claimText: 'DeepSeek-V3 architecture adopts Multi-head Latent Attention (MLA).',
          claimType: 'architecture',
          confidenceScore: 0.99,
          primarySourceUrl: 'https://github.com/deepseek-ai/DeepSeek-V3',
          sourcePublisher: 'DeepSeek AI',
          verbatimExcerpt: 'DeepSeek-V3 adopts Multi-head Latent Attention.',
        },
      ];

      const structuredEvidence = {
        whatHappened: 'DeepSeek has released DeepSeek-V3, a 671B parameter Mixture-of-Experts model.',
        technicalDetails: 'DeepSeek-V3 introduces Multi-head Latent Attention (MLA) and DeepSeekMoE architecture with auxiliary-loss-free load balancing.',
        capabilitiesAndFeatures: ['Multi-head Latent Attention', 'FP8 mixed precision training'],
        benchmarksAndResults: ['Outperforms open-source models on MMLU and MATH'],
        backgroundAndContext: 'Competes with proprietary frontier models at drastically reduced training cost.',
        limitationsAndCaveats: ['Requires high-end cluster deployment for full unquantized inference.'],
        quotesAndStatements: ['Architecture optimized for extreme compute efficiency.'],
        industrySignificance: 'Alters open-source AI economics globally.',
      };

      const { systemPrompt, userPrompt } = buildSynthesisPrompts(
        {
          topicTitle: 'DeepSeek-V3 Technical Breakthrough',
          verifiedClaims,
          rawSourceTexts: ['DeepSeek announces DeepSeek-V3 with MLA architecture.'],
          structuredEvidence,
        },
        true // Bilingual
      );

      // Verify prompt mandates
      expect(systemPrompt).toContain('TARGET LENGTH: 600 to 1,200 words in English');
      expect(systemPrompt).toContain('## What Happened');
      expect(systemPrompt).toContain('## Architecture & Technical Mechanics');
      expect(systemPrompt).toContain('## Performance & Benchmarks');
      expect(systemPrompt).toContain('## Background & Industry Context');
      expect(systemPrompt).toContain('## Limitations, Safety & Practical Constraints');
      expect(systemPrompt).toContain('## The Bottom Line');

      // Verify Bengali editorial instructions
      expect(systemPrompt).toContain('রিজনিং মডেল (Reasoning Model)');
      expect(systemPrompt).toContain('## আর্কিটেকচার ও প্রযুক্তিগত কার্যপ্রণালী');

      // Verify user prompt contains structured dossier
      expect(userPrompt).toContain('Multi-head Latent Attention (MLA)');
      expect(userPrompt).toContain('STRUCTURED RESEARCH DOSSIER:');
    });
  });

  describe('5. End-to-End Long-Form Bilingual Writer Verification', () => {
    it('synthesizes and persists substantial publication-quality bilingual article with rich sections', async () => {
      const db = await getDb();

      const [source] = await db
        .insert(schema.sources)
        .values({
          name: 'Google Research Blog',
          baseUrl: 'https://research.google/blog/feed.xml',
          sourceType: 'rss',
          tier: 'tier_1_primary',
        })
        .returning();

      const [story] = await db
        .insert(schema.stories)
        .values({
          title: 'Google DeepMind Details Gemini 2.0 Flash Thinking',
          summary: 'Gemini 2.0 Flash Thinking introduces native reasoning tokens with low latency.',
          category: 'multimodal',
          editorialStatus: 'auto_approved',
          riskLevel: 'low',
          importanceScore: 96,
          firstSeenAt: new Date(),
          lastUpdatedAt: new Date(),
          primarySourceId: source.id,
        })
        .returning();

      const longformEnglishBody = `# Gemini 2.0 Flash Thinking: The Architecture Behind Google's Native Reasoning

Google DeepMind has officially unveiled Gemini 2.0 Flash Thinking[^1], a specialized variant of Gemini 2.0 designed to perform dense reasoning while maintaining sub-second time-to-first-token latency.

## What Happened
The release marks Google's formal entry into test-time compute scaling within high-throughput production environments. Available immediately in Google AI Studio and Vertex AI, Flash Thinking provides enterprise developers with configurable reasoning budgets.

## Architecture & Technical Mechanics
Unlike traditional scratchpad models that simulate chain-of-thought through external prompt scaffolding, Gemini 2.0 Flash Thinking generates native reasoning tokens[^1]. Under this paradigm, the transformer allocates dynamic thinking capacity directly within its latent layers before generating visible output tokens. The architecture combines a mixture-of-experts backbone with optimized KV-cache compression, allowing long reasoning traces without memory exhaustion.

## Performance & Benchmarks
In comprehensive evaluations, Gemini 2.0 Flash Thinking established impressive metrics across standard problem-solving benchmarks. On the MATH 500 benchmark, the model scored 82.1%, rivaling much larger frontier systems while maintaining one-fifth of their inference latency. On HumanEval coding challenges, accuracy rose by 14% over Gemini 1.5 Flash.

## Background & Industry Context
The release comes amidst an industry-wide pivot toward test-time reasoning compute, popularized by OpenAI o-series models. However, where rival architectures often suffer from multi-second latency penalties, Google has prioritized throughput, targeting real-time agentic tool invocation.

## Limitations, Safety & Practical Constraints
DeepMind notes several practical constraints. The model is currently provided as an experimental preview with rate limits on free-tier API endpoints. Safety evaluations conducted under Google's Frontier Safety Framework confirm rigorous mitigations against deceptive alignment and hallucinated tool calls.

## The Bottom Line
Gemini 2.0 Flash Thinking demonstrates that advanced reasoning no longer requires sacrificing interactive speed, setting a new benchmark for low-latency autonomous agents.`;

      const longformBengaliBody = `# জেমিনি ২.০ ফ্ল্যাশ থিংকিং: গুগলের নেটিভ রিজনিং প্রযুক্তির বিস্তারিত রূপরেখা

গুগল ডিপমাইন্ড আনুষ্ঠানিকভাবে প্রকাশ করেছে জেমিনি ২.০ ফ্ল্যাশ থিংকিং (Gemini 2.0 Flash Thinking) মডেল [^1]। এটি অতি দ্রুত প্রতিক্রিয়া নিশ্চিত করার পাশাপাশি গভীর বিশ্লেষণী যুক্তি প্রয়োগ করতে সক্ষম।

## মূল ঘোষণা ও প্রেক্ষাপট
উন্নত রিজনিং সক্ষমতা সম্পন্ন এই মডেলটি গুগল এআই স্টুডিও এবং ভার্টেক্স এআই-তে উন্মুক্ত করা হয়েছে। ডেভেলপাররা এখন প্রয়োজন অনুসারে থিংকিং বাজেট সমন্বয় করতে পারবেন।

## আর্কিটেকচার ও প্রযুক্তিগত কার্যপ্রণালী
ঐতিহ্যবাহী প্রম্পট ইঞ্জিনিয়ারিং পদ্ধতির পরিবর্তে এই মডেলে যুক্ত করা হয়েছে নেটিভ রিজনিং টোকেন (Reasoning Tokens) [^1]। মডেলটি দৃশ্যমান উত্তর তৈরির পূর্বে নিজস্ব ল্যাটেন্ট স্তরে যুক্তিপ্রক্রিয়া সম্পন্ন করে। মিক্সচার-অব-এক্সপার্টস (MoE) এবং অপ্টিমাইজড মেমরি ক্যাশিং ব্যবস্থার কারণে দীর্ঘ যুক্তি পরিচালনায় কোনো জটিলতা সৃষ্টি হয় না।

## কর্মক্ষমতা ও বেঞ্চমার্ক ফলাফল
গাণিতিক সমস্যা সমাধানের বেঞ্চমার্কে মডেলটি ৮২.১% স্কোর অর্জন করেছে। কোডিং ও অ্যালগরিদমিক মূল্যায়নে পূর্ববর্তী সংস্করণের তুলনায় লক্ষণীয় অগ্রগতি দেখা গেছে।

## পটভূমি ও প্রযুক্তি বিশ্বের প্রেক্ষাপট
ওপেনএআই এবং অ্যানথ্রপিকের রিজনিং মডেলগুলোর সাথে প্রতিযোগিতায় গুগল গতি ও বাস্তবসম্মত অ্যাপ্লিকেশন ব্যবহারের ওপর জোর দিয়েছে।

## সীমাবদ্ধতা, সুরক্ষা ও ব্যবহারিক চ্যালেঞ্জ
মডেলটি বর্তমানে পরীক্ষামূলক প্রিভিউ হিসেবে উন্মুক্ত রয়েছে। গুগলের সেফটি ফ্রেমওয়ার্ক অনুযায়ী এর নিরাপত্তা ঝুঁকি নিবিড়ভাবে মূল্যায়ন করা হয়েছে।

## সামগ্রিক মূল্যায়ন ও ভবিষ্যতের পথরেখা
জেমিনি ২.০ ফ্ল্যাশ থিংকিং প্রমাণ করে যে যুক্তিনির্ভর জটিল চিন্তার জন্য গতির সাথে আপস করতে হয় না।`;

      const mockProvider = new MockAiProvider();
      mockProvider.enqueueStructuredResponse({
        slug: 'gemini-2-0-flash-thinking-architecture-deepmind',
        en: {
          title: 'Google DeepMind Unveils Gemini 2.0 Flash Thinking with Native Reasoning',
          summary:
            'A low-latency frontier reasoning model that combines test-time compute scaling with sub-second response times.',
          content: longformEnglishBody,
          keyTakeaways: [
            'Native reasoning tokens integrated directly into transformer latent layers.',
            'Scores 82.1% on MATH 500 benchmark while retaining interactive latency.',
            'Available immediately in Google AI Studio and Vertex AI preview.',
          ],
        },
        bn: {
          title: 'গুগল ডিপমাইন্ড উন্মোচন করল জেমিনি ২.০ ফ্ল্যাশ থিংকিং রিজনিং মডেল',
          summary: 'দ্রুতগতির রেসপন্স এবং গভীর যুক্তি বিশ্লেষণের অনন্য সমন্বয় নিয়ে গুগলের নতুন উদ্ভাবন।',
          content: longformBengaliBody,
          keyTakeaways: [
            'ট্রান্সফরমার স্তরে নেটিভ রিজনিং টোকেন ব্যবহারের উদ্ভাবনী প্রযুক্তি।',
            'MATH 500 বেঞ্চমার্কে ৮২.১% নির্ভুলতা অর্জনে সক্ষম।',
            'গুগল এআই স্টুডিওতে ডেভেলপারদের জন্য উন্মুক্ত।',
          ],
        },
        citations: [
          {
            citationIndex: 1,
            claimIndex: 0,
            anchorText: 'Gemini 2.0 Flash Thinking',
            primarySourceUrl: 'https://research.google/gemini-2-flash-thinking',
            sourcePublisher: 'Google DeepMind',
          },
        ],
      });

      const packet: EvidencePacket = {
        storyId: story.id,
        primarySources: [
          {
            title: 'Gemini 2.0 Flash Thinking Release',
            url: 'https://research.google/gemini-2-flash-thinking',
            text: 'Google DeepMind announces Gemini 2.0 Flash Thinking with native reasoning tokens.',
            sourceName: 'Google DeepMind',
            sourceTier: 'tier_1_primary',
          },
        ],
        secondarySources: [],
        confirmedFacts: [
          'Gemini 2.0 Flash Thinking introduces native reasoning tokens with low latency.',
          'Model achieves 82.1% on MATH 500 benchmark evaluations.',
        ],
        differingPerspectives: ['Preview tier limits current high-concurrency enterprise batch jobs.'],
        structuredDetails: {
          whatHappened: 'Google DeepMind announced Gemini 2.0 Flash Thinking.',
          technicalDetails: 'Native reasoning tokens generated in latent transformer layers.',
          capabilitiesAndFeatures: ['Native reasoning tokens', 'Sub-second first token latency'],
          benchmarksAndResults: ['82.1% on MATH 500'],
          backgroundAndContext: 'Response to test-time compute scaling across frontier labs.',
          limitationsAndCaveats: ['Experimental preview quota limitations.'],
          quotesAndStatements: [],
          industrySignificance: 'Sets new standard for real-time agentic reasoning.',
        },
      };

      const writer = new MultiSourceWriterAgent(mockProvider);
      const article = await writer.synthesizeStoryArticle(packet, {
        publicationIntent: 'published',
      });

      expect(article.id).toBeDefined();
      expect(article.status).toBe('published');
      expect(article.titleEn).toContain('Gemini 2.0 Flash Thinking');
      expect(article.titleBn).toContain('জেমিনি ২.০ ফ্ল্যাশ থিংকিং');
      expect(article.contentEn).toContain('## Architecture & Technical Mechanics');
      expect(article.contentEn).toContain('## Performance & Benchmarks');
      expect(article.contentEn).toContain('## Limitations, Safety & Practical Constraints');
      expect(article.contentBn).toContain('## আর্কিটেকচার ও প্রযুক্তিগত কার্যপ্রণালী');
      expect(article.contentBn).toContain('## সীমাবদ্ধতা, সুরক্ষা ও ব্যবহারিক চ্যালেঞ্জ');
      expect(article.keyTakeawaysEn).toHaveLength(3);
      expect(article.keyTakeawaysBn).toHaveLength(3);
      expect(article.readingTimeMinutes).toBeGreaterThanOrEqual(1);

      // Verify in DB
      const [saved] = await db
        .select()
        .from(schema.articles)
        .where(eq(schema.articles.id, article.id));

      expect(saved.slug).toBe('gemini-2-0-flash-thinking-architecture-deepmind');

      const dbCitations = await db
        .select()
        .from(schema.articleCitations)
        .where(eq(schema.articleCitations.articleId, article.id));

      expect(dbCitations).toHaveLength(1);
      expect(dbCitations[0].anchorText).toBe('Gemini 2.0 Flash Thinking');
    });
  });

  describe('6. Fact / Context / Analysis Separation (Epistemic Protocol)', () => {
    it('validates epistemic separation and rejects dogmatic unhedged speculation', () => {
      const speculativeContent = `# The Rise of Autonomous Intelligence
This release will certainly render all software engineers obsolete within two years. It represents an unprecedented breakthrough.`;

      const result = validateEpistemicSeparation(speculativeContent);
      expect(result.isValid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]).toContain('Dogmatic speculation presented as unhedged fact');
    });

    it('rejects predictive forward-looking speculation inappropriately tagged with factual citations', () => {
      const citedFuturePrediction = `# Future of Model Deployment
In the coming decades, this architecture will replace all current GPU clusters[^1].`;

      const result = validateEpistemicSeparation(citedFuturePrediction);
      expect(result.isValid).toBe(false);
      expect(result.violations[0]).toContain('Predictive speculation inappropriately tagged with factual citation');
    });

    it('approves rigorous journalism with proper analytical qualifiers and objective empirical grounding', () => {
      const rigorousContent = `# Frontier Model Analysis
The benchmark evaluations report an 82.1% score on MATH 500[^1]. Analysis suggests this architecture reduces KV-cache memory pressure during multi-turn generation. Industry observers note that real-world developer adoption will depend on API pricing tiers.`;

      const result = validateEpistemicSeparation(rigorousContent);
      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('7. Category-Aware Article Structures', () => {
    it('adapts mandatory technical sections across all 5 editorial categories', () => {
      const categories = ['llm_release', 'agentic', 'infra', 'research', 'policy'] as const;
      expect(Object.keys(CATEGORY_EDITORIAL_TEMPLATES)).toEqual(expect.arrayContaining(categories as unknown as string[]));

      for (const cat of categories) {
        const template = getCategoryEditorialTemplate(cat);
        expect(template.category).toBe(cat);
        expect(template.sections.length).toBeGreaterThanOrEqual(6);
        expect(template.titleGuidance).toBeDefined();

        // Check English and Bengali headings exist for each section
        for (const s of template.sections) {
          expect(s.enHeading).toBeDefined();
          expect(s.bnHeading).toBeDefined();
          expect(s.description).toBeDefined();
          expect(['FACT', 'CONTEXT', 'ANALYSIS']).toContain(s.epistemicClass);
        }
      }

      // Verify category-specific sections in prompt builder
      const agenticPrompt = buildSynthesisPrompts(
        {
          topicTitle: 'OpenAI Operator Preview',
          verifiedClaims: [
            normalizeVerifiedClaim({
              claimText: 'Operator executes browser actions autonomously.',
              confidenceScore: 0.95,
            }),
          ],
          rawSourceTexts: ['Operator runs browser tasks.'],
          category: 'agentic',
        },
        true
      );
      expect(agenticPrompt.systemPrompt).toContain('EDITORIAL CATEGORY: AGENTIC');
      expect(agenticPrompt.systemPrompt).toContain('## Autonomous Framework Overview');
      expect(agenticPrompt.systemPrompt).toContain('## Tool Use & Execution Architecture');
      expect(agenticPrompt.systemPrompt).toContain('## Reasoning Traces & Decision Benchmarks');

      const infraPrompt = buildSynthesisPrompts(
        {
          topicTitle: 'Nvidia Blackwell Ultra Architecture',
          verifiedClaims: [
            normalizeVerifiedClaim({
              claimText: 'Blackwell Ultra delivers 20 petaflops of FP4 compute.',
              confidenceScore: 0.98,
            }),
          ],
          rawSourceTexts: ['Blackwell compute details.'],
          category: 'infra',
        },
        false
      );
      expect(infraPrompt.systemPrompt).toContain('EDITORIAL CATEGORY: INFRA');
      expect(infraPrompt.systemPrompt).toContain('## Compute & Hardware Milestone');
      expect(infraPrompt.systemPrompt).toContain('## Scalability, Throughput & Memory Bandwidth');
      expect(infraPrompt.systemPrompt).toContain('## Efficiency & Serving Economics');

      const policyPrompt = buildSynthesisPrompts(
        {
          topicTitle: 'EU AI Act Enforcement Begins',
          verifiedClaims: [
            normalizeVerifiedClaim({
              claimText: 'EU establishes general-purpose AI model compliance requirements.',
              confidenceScore: 0.96,
            }),
          ],
          rawSourceTexts: ['EU AI Act details.'],
          category: 'policy',
        },
        false
      );
      expect(policyPrompt.systemPrompt).toContain('EDITORIAL CATEGORY: POLICY');
      expect(policyPrompt.systemPrompt).toContain('## Regulatory & Governance Action');
      expect(policyPrompt.systemPrompt).toContain('## Enforcement Mechanisms & Compliance Standards');
    });
  });

  describe('8. English + Bangla Information Parity Validation', () => {
    it('approves dual-language articles with high information parity and rich sections', () => {
      const draft = {
        slug: 'llama-parity-test',
        en: {
          title: 'Meta Releases Llama 3.3 with 70B Parameters',
          summary: 'Meta releases high-efficiency open model.',
          content: `# Headline
Executive summary of the release.
## What Happened
Meta has officially launched Llama 3.3 70B[^1].
## Architecture & Technical Mechanics
The model incorporates grouped-query attention and optimized rotary position embeddings.
## Performance & Benchmarks
Evaluations on MMLU reach 88.6%[^1].
## Background & Industry Context
Llama 3.3 matches earlier 405B capabilities.
## Limitations, Safety & Practical Constraints
Requires multi-GPU setup for unquantized weights.
## The Bottom Line
Reduces compute barriers for developers globally.`,
          keyTakeaways: ['Key takeaway 1', 'Key takeaway 2'],
        },
        bn: {
          title: 'মেটা উন্মোচন করল লামা ৩.৩ ৭০বি মডেল',
          summary: 'উচ্চ কার্যক্ষমতার নতুন ওপেন-সোর্স মডেল।',
          content: `# শিরোনাম
মডেলের মূল ঘোষণা ও নির্বাহী সারসংক্ষেপ।
## মূল ঘোষণা ও প্রেক্ষাপট
মেটা আনুষ্ঠানিকভাবে লামা ৩.৩ ৭০বি মডেল প্রকাশ করেছে[^1]।
## আর্কিটেকচার ও প্রযুক্তিগত কার্যপ্রণালী
গ্রুপড-কোয়েরি অ্যাটেনশন এবং উন্নত রোটারি পজিশন এম্বেডিং প্রযুক্তির সমন্বয় করা হয়েছে।
## কর্মক্ষমতা ও বেঞ্চমার্ক ফলাফল
এমএমএলইউ মূল্যায়নে মডেলটি ৮৮.৬% নির্ভুলতা প্রদর্শন করেছে[^1]।
## পটভূমি ও প্রযুক্তি বিশ্বের প্রেক্ষাপট
পূর্ববর্তী ৪০৫বি মডেলের সমকক্ষ ফলাফল প্রদান করে।
## সীমাবদ্ধতা, সুরক্ষা ও ব্যবহারিক চ্যালেঞ্জ
সম্পূর্ণ মডেল পরিচালনায় উচ্চ কম্পিউট পরিকাঠামো প্রয়োজন।
## সামগ্রিক মূল্যায়ন ও ভবিষ্যতের পথরেখা
গবেষক ও ডেভেলপারদের কম্পিউট ব্যয় বহুলাংশে হ্রাস করবে।`,
          keyTakeaways: ['মূল তথ্য ১', 'মূল তথ্য ২'],
        },
        citations: [
          {
            citationIndex: 1,
            claimIndex: 0,
            anchorText: 'Llama 3.3',
            primarySourceUrl: 'https://ai.meta.com',
            sourcePublisher: 'Meta',
          },
        ],
      };

      const result = validateBilingualParity(draft);
      expect(result.isValid).toBe(true);
      expect(result.wordCountRatio).toBeGreaterThan(0.25);
      expect(result.bnSectionsCount).toBeGreaterThanOrEqual(6);
    });

    it('rejects lossy, truncated Bengali summary that lacks substantive sections', () => {
      const truncatedDraft = {
        slug: 'truncated-summary-test',
        en: {
          title: 'Google DeepMind Unveils Gemini 2.0 Flash Thinking with Native Reasoning',
          summary: 'A low-latency frontier reasoning model.',
          content: `# Gemini 2.0 Flash Thinking
Google DeepMind has officially unveiled Gemini 2.0 Flash Thinking[^1].
## What Happened
The release marks Google formal entry into test-time compute scaling. Available in Google AI Studio and Vertex AI.
## Architecture & Technical Mechanics
Unlike traditional scratchpad models, Flash Thinking generates native reasoning tokens directly within its latent layers.
## Performance & Benchmarks
In comprehensive evaluations, the model scored 82.1% on MATH 500.
## Background & Industry Context
The release comes amidst an industry-wide pivot toward test-time reasoning compute.
## Limitations, Safety & Practical Constraints
DeepMind notes several practical constraints. The model is currently provided as an experimental preview.
## The Bottom Line
Demonstrates that advanced reasoning no longer requires sacrificing interactive speed.`,
          keyTakeaways: ['Takeaway 1', 'Takeaway 2'],
        },
        bn: {
          title: 'গুগল নতুন মডেল উন্মোচন করল',
          summary: 'সংক্ষিপ্ত সারসংক্ষেপ।',
          content: 'গুগল একটি নতুন রিজনিং মডেল প্রকাশ করেছে যা খুব দ্রুত কাজ করে। এটি এখন ব্যবহার করা যাবে।',
          keyTakeaways: [],
        },
        citations: [
          {
            citationIndex: 1,
            claimIndex: 0,
            anchorText: 'Gemini',
            primarySourceUrl: 'https://google.com',
            sourcePublisher: 'Google',
          },
        ],
      };

      const result = validateBilingualParity(truncatedDraft);
      expect(result.isValid).toBe(false);
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(result.error).toContain('severely truncated');

      expect(() => {
        throw new BilingualParityError('Sample parity failure');
      }).toThrow(BilingualParityError);
    });
  });
});