import { z } from 'zod';
import { AiModelProvider } from '../ai/provider';
import { AgentAuditLogger } from '../research/audit-logger';
import { PlagiarismDetector, PlagiarismCheckResult } from './plagiarism-detector';

export const ArticleCitationSchema = z.object({
  citationIndex: z.number().int().positive().describe('Numbered index in the article body [^1], [^2].'),
  claimIndex: z.number().int().nonnegative().describe('0-indexed pointer to the verified claim in the input list.'),
  anchorText: z.string().describe('Key phrase or term in the text to associate with this citation.'),
  primarySourceUrl: z.string().url().describe('The verified primary URL of the source.'),
  sourcePublisher: z.string().describe('Name of the publishing organization (e.g. OpenAI, arXiv, DeepMind).'),
});

export const SynthesizedArticleDraftSchema = z.object({
  title: z.string().max(120).describe('Journalistic headline, active voice, non-sensational.'),
  deck: z.string().max(250).describe('Summary deck / subhead explaining the core development.'),
  slug: z.string().describe('URL-friendly kebab-case slug.'),
  contentMarkdown: z.string().describe('Body of the article in markdown with inline footnote tags [^1], [^2].'),
  metaDescription: z.string().max(160).describe('SEO description under 160 characters.'),
  citations: z.array(ArticleCitationSchema).describe('Complete list of mapped citations.'),
});

export const BilingualLanguageContentSchema = z.object({
  title: z.string().max(255).describe('Journalistic headline, active voice, non-sensational.'),
  summary: z.string().describe('Executive summary deck explaining the core development.'),
  content: z.string().describe('Body of the article in markdown with inline footnote tags [^1], [^2].'),
  keyTakeaways: z.array(z.string()).default([]).describe('List of 2-4 bullet key takeaways.'),
});

export const BilingualArticleDraftSchema = z.object({
  slug: z.string().describe('URL-friendly kebab-case ASCII Latin slug.'),
  en: BilingualLanguageContentSchema,
  bn: BilingualLanguageContentSchema,
  citations: z.array(ArticleCitationSchema).default([]),
});

export type BilingualArticleDraft = z.infer<typeof BilingualArticleDraftSchema>;

export function ensureLatinSlug(rawSlug: string, fallbackTitle: string): string {
  const cleaned = (rawSlug || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/[\s-]+/g, '-');
  if (cleaned.length >= 3) return cleaned;

  const fallbackCleaned = (fallbackTitle || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/[\s-]+/g, '-');
  if (fallbackCleaned.length >= 3) return fallbackCleaned;

  return `intel-briefing-${Date.now().toString(36)}`;
}

export interface BilingualSynthesisResult {
  draft: SynthesizedArticleDraft;
  bilingualDraft: BilingualArticleDraft;
  plagiarismAudit: PlagiarismCheckResult;
  runId?: string;
  readingTimeMinutes: number;
}

export type SynthesizedArticleDraft = z.infer<typeof SynthesizedArticleDraftSchema>;

export interface VerifiedClaimInput {
  id?: string;
  claimText: string;
  claimType: string;
  confidenceScore: number;
  primarySourceUrl: string;
  sourcePublisher: string;
  verbatimExcerpt: string;
}

export interface SynthesisResult {
  draft: SynthesizedArticleDraft;
  plagiarismAudit: PlagiarismCheckResult;
  runId?: string;
  readingTimeMinutes: number;
}

export class PlagiarismGateError extends Error {
  constructor(public audit: PlagiarismCheckResult) {
    super(
      `Article draft exceeded verbatim similarity limit (${(audit.maxSimilarity * 100).toFixed(1)}% > 12%). Offending phrases: ${audit.offendingPhrases.join(', ')}`
    );
    this.name = 'PlagiarismGateError';
  }
}

export class EditorialSynthesisAgent {
  private aiProvider: AiModelProvider;
  private logger: AgentAuditLogger;
  private plagiarismDetector: PlagiarismDetector;

  constructor(
    aiProvider: AiModelProvider,
    logger?: AgentAuditLogger,
    plagiarismDetector?: PlagiarismDetector
  ) {
    this.aiProvider = aiProvider;
    this.logger = logger || new AgentAuditLogger();
    this.plagiarismDetector = plagiarismDetector || new PlagiarismDetector();
  }

  async synthesizeArticle(params: {
    topicTitle: string;
    verifiedClaims: VerifiedClaimInput[];
    rawSourceTexts: string[];
    storyClusterId?: string;
  }): Promise<SynthesisResult> {
    if (params.verifiedClaims.length === 0) {
      throw new Error('Cannot synthesize article: No verified claims provided.');
    }

    const startTime = Date.now();
    let runId: string | undefined;

    try {
      runId = await this.logger.startRun({
        agentName: 'EditorialSynthesisAgent',
        agentVersion: '1.0.0',
        modelProvider: this.aiProvider.providerName,
        modelName: this.aiProvider.defaultModel,
        storyClusterId: params.storyClusterId,
      });
    } catch {
      // Graceful logger fallback
    }

    const claimsContext = params.verifiedClaims
      .map(
        (c, idx) =>
          `[Claim ${idx}] (${c.claimType})
Claim: ${c.claimText}
Confidence: ${c.confidenceScore}
Source: ${c.sourcePublisher} (${c.primarySourceUrl})
Verified Excerpt: "${c.verbatimExcerpt}"`
      )
      .join('\n\n');

    const systemPrompt = `You are NAKSHATRA's Lead Editorial Journalist.
Your mandate is to craft an original, concise, evidence-backed news article based ONLY on the provided VERIFIED CLAIMS.

INVIOLABLE RULES:
1. Grounding: You may ONLY state facts directly derived from the verified claims. Zero speculation.
2. Inline Footnotes: For every factual statement, append an inline citation token like [^1], [^2] referencing the citation list.
3. Originality: Write in clear, active journalistic prose. DO NOT copy more than 4 consecutive words verbatim from source text.
4. Completeness: Ensure all citations mapped in the citations array match the [^N] numbers in the body.

The output MUST be a valid JSON object strictly matching this schema:
{
  "title": "string (Journalistic headline, max 120 chars)",
  "deck": "string (Summary deck / subhead explaining the core development, max 250 chars)",
  "slug": "string (URL-friendly kebab-case Latin slug)",
  "contentMarkdown": "string (Article body in markdown with inline [^1] citations)",
  "metaDescription": "string (SEO description under 160 chars)",
  "citations": [
    {
      "citationIndex": 1,
      "claimIndex": 0,
      "anchorText": "Key phrase from text",
      "primarySourceUrl": "https://example.com/source",
      "sourcePublisher": "Publisher name"
    }
  ]
}`;

    const userPrompt = `Story Topic: ${params.topicTitle}

VERIFIED CLAIMS LIST:
${claimsContext}

Generate the full synthesized article draft in JSON conforming strictly to the expected schema.`;

    try {
      const response = await this.aiProvider.generateStructured(
        userPrompt,
        SynthesizedArticleDraftSchema,
        {
          systemPrompt,
          temperature: 0.2,
        }
      );

      const draft = response.data;

      // Deterministic N-Gram Anti-Plagiarism Gate Check
      const plagiarismAudit = this.plagiarismDetector.check(
        draft.contentMarkdown,
        params.rawSourceTexts
      );

      if (!plagiarismAudit.isAcceptable) {
        throw new PlagiarismGateError(plagiarismAudit);
      }

      // Calculate reading time (avg 200 words per minute)
      const wordCount = draft.contentMarkdown.split(/\s+/).length;
      const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

      if (runId) {
        await this.logger.logStep({
          agentRunId: runId,
          stepNumber: 1,
          actionName: 'synthesize_article',
          inputPayload: {
            topic: params.topicTitle,
            claimsCount: params.verifiedClaims.length,
          },
          outputPayload: {
            title: draft.title,
            citationsCount: draft.citations.length,
            similarityScore: plagiarismAudit.maxSimilarity,
          },
          rationale: `Synthesized original draft with ${draft.citations.length} inline citations and ${(plagiarismAudit.maxSimilarity * 100).toFixed(1)}% verbatim similarity.`,
        });

        await this.logger.finishRun(runId, {
          status: 'success',
          promptTokens: response.promptTokens,
          completionTokens: response.completionTokens,
          latencyMs: Date.now() - startTime,
        });
      }

      return {
        draft,
        plagiarismAudit,
        runId,
        readingTimeMinutes,
      };
    } catch (err: any) {
      if (runId) {
        await this.logger.finishRun(runId, {
          status: 'failed',
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: Date.now() - startTime,
          errorMessage: err.message || String(err),
        });
      }
      throw err;
    }
  }

  async synthesizeBilingualArticle(params: {
    topicTitle: string;
    verifiedClaims: VerifiedClaimInput[];
    rawSourceTexts: string[];
    storyClusterId?: string;
  }): Promise<BilingualSynthesisResult> {
    if (params.verifiedClaims.length === 0) {
      throw new Error('Cannot synthesize article: No verified claims provided.');
    }

    const startTime = Date.now();
    let runId: string | undefined;

    try {
      runId = await this.logger.startRun({
        agentName: 'EditorialSynthesisAgent',
        agentVersion: '2.0.0-bilingual',
        modelProvider: this.aiProvider.providerName,
        modelName: this.aiProvider.defaultModel,
        storyClusterId: params.storyClusterId,
      });
    } catch {
      // Graceful logger fallback
    }

    const claimsContext = params.verifiedClaims
      .map(
        (c, idx) =>
          `[Claim ${idx}] (${c.claimType})\nClaim: ${c.claimText}\nConfidence: ${c.confidenceScore}\nSource: ${c.sourcePublisher} (${c.primarySourceUrl})\nVerified Excerpt: "${c.verbatimExcerpt}"`
      )
      .join('\n\n');

    const systemPrompt = `You are NAKSHATRA's Lead Bilingual Editorial Journalist and AI Researcher.
Your mandate is to craft an authoritative dual-language news briefing in both English (en) and Bengali (bn) based ONLY on the provided VERIFIED CLAIMS.

INVIOLABLE RULES:
1. Grounding: You may ONLY state facts directly derived from the verified claims. Zero speculation.
2. Inline Footnotes: For every factual statement in BOTH languages, append inline citation tokens like [^1], [^2] referencing the citation list.
3. Originality: Write in clear, active journalistic prose. DO NOT copy more than 4 consecutive words verbatim from source text.
4. Completeness: Ensure all citations mapped in the citations array match the [^N] numbers in both body texts.
5. Slug Standard: The "slug" field MUST be strictly ASCII Latin kebab-case [a-z0-9-] suitable for clean URL sharing.
6. Bengali Editorial Standard:
   - Modern, natural tech Bengali (avoid awkward, archaic or overly literal translations).
   - Retain standard AI concepts transliterated or parenthesized in English (e.g. "রিজনিং মডেল (Reasoning Model)", "ফাইন-টিউনিং", "কনটেক্সট উইন্ডো", "মাল্টি-মোডাল").

The output MUST be a valid JSON object strictly matching this schema:
{
  "slug": "kebab-case-latin-slug",
  "en": {
    "title": "Journalistic headline in English (max 255 chars)",
    "summary": "Executive summary deck explaining the core development",
    "content": "Article body in English markdown with inline citations [^1]",
    "keyTakeaways": ["Key bullet 1", "Key bullet 2"]
  },
  "bn": {
    "title": "Journalistic headline in Bengali (max 255 chars)",
    "summary": "Executive summary deck in Bengali",
    "content": "Article body in Bengali markdown with inline citations [^1]",
    "keyTakeaways": ["Key bullet 1 in Bengali", "Key bullet 2 in Bengali"]
  },
  "citations": [
    {
      "citationIndex": 1,
      "claimIndex": 0,
      "anchorText": "Key phrase from text",
      "primarySourceUrl": "https://example.com/source",
      "sourcePublisher": "Publisher name"
    }
  ]
}`;

    const userPrompt = `Story Topic: ${params.topicTitle}

VERIFIED CLAIMS LIST:
${claimsContext}

Generate the full synthesized bilingual article draft in JSON conforming strictly to the expected schema (with fields: slug, en, bn, citations).`;

    try {
      const response = await this.aiProvider.generateStructured(
        userPrompt,
        BilingualArticleDraftSchema,
        {
          systemPrompt,
          temperature: 0.2,
        }
      );

      const cleanSlug = ensureLatinSlug(response.data.slug, response.data.en.title);
      const bilingualDraft: BilingualArticleDraft = {
        slug: cleanSlug,
        en: {
          title: response.data.en.title,
          summary: response.data.en.summary,
          content: response.data.en.content,
          keyTakeaways: response.data.en.keyTakeaways || [],
        },
        bn: {
          title: response.data.bn.title,
          summary: response.data.bn.summary,
          content: response.data.bn.content,
          keyTakeaways: response.data.bn.keyTakeaways || [],
        },
        citations: response.data.citations || [],
      };

      // Deterministic N-Gram Anti-Plagiarism Gate Check on English content
      const plagiarismAudit = this.plagiarismDetector.check(
        bilingualDraft.en.content,
        params.rawSourceTexts
      );

      if (!plagiarismAudit.isAcceptable) {
        throw new PlagiarismGateError(plagiarismAudit);
      }

      // Legacy compatibility draft
      const draft: SynthesizedArticleDraft = {
        title: bilingualDraft.en.title,
        deck: bilingualDraft.en.summary,
        slug: cleanSlug,
        contentMarkdown: bilingualDraft.en.content,
        metaDescription: bilingualDraft.en.summary.slice(0, 160),
        citations: bilingualDraft.citations,
      };

      const wordCount = bilingualDraft.en.content.split(/\s+/).length;
      const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

      if (runId) {
        await this.logger.logStep({
          agentRunId: runId,
          stepNumber: 1,
          actionName: 'synthesize_bilingual_article',
          inputPayload: {
            topic: params.topicTitle,
            claimsCount: params.verifiedClaims.length,
          },
          outputPayload: {
            titleEn: bilingualDraft.en.title,
            titleBn: bilingualDraft.bn.title,
            citationsCount: draft.citations.length,
            similarityScore: plagiarismAudit.maxSimilarity,
          },
          rationale: `Synthesized bilingual draft with ${draft.citations.length} citations.`,
        });

        await this.logger.finishRun(runId, {
          status: 'success',
          promptTokens: response.promptTokens,
          completionTokens: response.completionTokens,
          latencyMs: Date.now() - startTime,
        });
      }

      return {
        draft,
        bilingualDraft,
        plagiarismAudit,
        runId,
        readingTimeMinutes,
      };
    } catch (err: any) {
      if (runId) {
        await this.logger.finishRun(runId, {
          status: 'failed',
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: Date.now() - startTime,
          errorMessage: err.message || String(err),
        });
      }
      throw err;
    }
  }
}
