import { z } from 'zod';
import { AiModelProvider } from '../ai/provider';
import { AgentAuditLogger } from '../research/audit-logger';
import { PlagiarismDetector, PlagiarismCheckResult } from './plagiarism-detector';

export interface StructuredEvidenceDetails {
  whatHappened?: string;
  technicalDetails?: string;
  capabilitiesAndFeatures?: string[];
  benchmarksAndResults?: string[];
  backgroundAndContext?: string;
  limitationsAndCaveats?: string[];
  quotesAndStatements?: string[];
  industrySignificance?: string;
}

export const ArticleCitationSchema = z.object({
  citationIndex: z.number().int().positive().describe('Numbered index in the article body [^1], [^2].'),
  claimIndex: z.number().int().nonnegative().describe('0-indexed pointer to the verified claim in the input list.'),
  anchorText: z.string().describe('Key phrase or term in the text to associate with this citation.'),
  primarySourceUrl: z.string().describe('The verified primary URL of the source.'),
  sourcePublisher: z.string().describe('Name of the publishing organization (e.g. OpenAI, arXiv, DeepMind).'),
});

export const SynthesizedArticleDraftSchema = z.object({
  title: z.string().max(255).describe('Journalistic headline, active voice, non-sensational, informative.'),
  deck: z.string().max(500).describe('Executive summary deck / subhead explaining the core development and context.'),
  slug: z.string().describe('URL-friendly kebab-case Latin slug.'),
  contentMarkdown: z.string().describe('Body of the article in markdown with inline footnote tags [^1], [^2], structured with comprehensive sections (600-1200 words).'),
  metaDescription: z.string().max(250).describe('SEO description under 250 characters.'),
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

export interface SynthesisAgentInput {
  topicTitle: string;
  verifiedClaims: VerifiedClaimInput[];
  rawSourceTexts: string[];
  storyClusterId?: string;
  structuredEvidence?: StructuredEvidenceDetails;
  primarySourceUrl?: string;
  primaryPublisher?: string;
}

export function buildSynthesisPrompts(params: SynthesisAgentInput, isBilingual = false): {
  systemPrompt: string;
  userPrompt: string;
} {
  const claimsContext = params.verifiedClaims
    .map(
      (c, idx) =>
        `[Claim ${idx}] (${c.claimType})\nClaim: ${c.claimText}\nConfidence: ${c.confidenceScore}\nSource: ${c.sourcePublisher} (${c.primarySourceUrl})\nVerified Excerpt: "${c.verbatimExcerpt}"`
    )
    .join('\n\n');

  let dossierSection = '';
  if (params.structuredEvidence) {
    const se = params.structuredEvidence;
    const caps = (se.capabilitiesAndFeatures || []).map((f) => `  * ${f}`).join('\n');
    const benchs = (se.benchmarksAndResults || []).map((b) => `  * ${b}`).join('\n');
    const limits = (se.limitationsAndCaveats || []).map((l) => `  * ${l}`).join('\n');
    const quotes = (se.quotesAndStatements || []).map((q) => `  * "${q}"`).join('\n');

    dossierSection = `
STRUCTURED RESEARCH DOSSIER:
- Core Development: ${se.whatHappened || 'See verified claims'}
- Architecture & Technical Mechanics: ${se.technicalDetails || 'Refer to primary source'}
- Key Capabilities & Features:
${caps || '  * See verified claims'}
- Quantifiable Benchmarks & Performance:
${benchs || '  * State reported metrics from verified claims or explicitly note where quantitative evaluations have not yet been made public'}
- Historical Lineage & Industry Context: ${se.backgroundAndContext || 'Refer to industry landscape'}
- Limitations, Safety & Practical Constraints:
${limits || '  * State known limitations or active safety evaluations'}
- Direct Quotes & Official Statements:
${quotes || '  * None'}
- Strategic Ecosystem Impact: ${se.industrySignificance || 'Significant evolution in the AI landscape'}
`;
  }

  const primaryRaw = (params.rawSourceTexts[0] || '').trim();
  const sourceContext = primaryRaw
    ? `\nPRIMARY SOURCE REFERENCE MATERIAL (Use to understand technical mechanics and provide clear explanations; do NOT copy verbatim):\n"""\n${primaryRaw.slice(0, 4000)}\n"""\n`
    : '';

  if (isBilingual) {
    const systemPrompt = `You are NAKSHATRA's Lead Bilingual Editorial Journalist and AI Researcher.
Your mandate is to craft an authoritative, comprehensive dual-language news article in English (en) and Bengali (bn) based on the provided VERIFIED CLAIMS and RESEARCH DOSSIER.

TARGET LENGTH: 600 to 1,200 words in English, and equivalent substantive depth in Bengali.

EDITORIAL MISSION & TONE:
- Deep, rigorous, beginner-friendly technical journalism. Think Quanta Magazine meets Ars Technica.
- Explain the 'how' and 'why', not just the 'what'. Deconstruct technical mechanics, architectural principles, and real-world implications clearly so non-specialists understand the breakthrough without diluting technical precision.
- Grounded & Objective: Base all claims, numbers, quotes, and attributions on the provided evidence. DO NOT hallucinate benchmarks, dates, or specifications that do not exist.
- No Fluff: Avoid vapid PR cliches ('In the fast-evolving world of AI...', 'A groundbreaking milestone that changes everything...'). Every paragraph must deliver concrete technical explanation or analytical insight.
- Plagiarism Safety: Synthesize entirely in your own original journalistic words. Do not copy multi-word phrases verbatim from sources.

REQUIRED ARTICLE STRUCTURE (In both English and Bengali markdown content):
- Opening hook and executive summary
- ## What Happened (English) / ## মূল ঘোষণা ও প্রেক্ষাপট (Bengali)
- ## Architecture & Technical Mechanics (English) / ## আর্কিটেকচার ও প্রযুক্তিগত কার্যপ্রণালী (Bengali)
- ## Performance & Benchmarks (English) / ## কর্মক্ষমতা ও বেঞ্চমার্ক ফলাফল (Bengali)
- ## Background & Industry Context (English) / ## পটভূমি ও প্রযুক্তি বিশ্বের প্রেক্ষাপট (Bengali)
- ## Limitations, Safety & Practical Constraints (English) / ## সীমাবদ্ধতা, সুরক্ষা ও ব্যবহারিক চ্যালেঞ্জ (Bengali)
- ## The Bottom Line (English) / ## সামগ্রিক মূল্যায়ন ও ভবিষ্যতের পথরেখা (Bengali)

BENGALI JOURNALISM DIRECTIVE:
- High-caliber, natural tech Bengali (comparable to Prothom Alo / Anandabazar tech desk).
- NEVER use crude literal machine translations.
- Transliterate standard AI terms or parenthesize them in English (e.g. 'রিজনিং মডেল (Reasoning Model)', 'প্যারামিটার', 'টোকেনাইজেশন', 'কনটেক্সট উইন্ডো', 'ফাইন-টিউনিং', 'বেঞ্চমার্ক', 'ওপেন-সোর্স').
- Match the structural depth and section layout of the English version.
- Maintain inline footnotes [^1], [^2] in the Bengali body text.

INLINE CITATION PROTOCOL:
- Every factual assertion, technical metric, benchmark, or quote in BOTH languages MUST include inline citation tags like [^1], [^2].
- Distribute citations across all sections.
- Every citation [^N] must correspond to an entry in the 'citations' array, where claimIndex is the 0-based index in the VERIFIED CLAIMS list.
- Slug Standard: The "slug" field MUST be strictly ASCII Latin kebab-case [a-z0-9-] suitable for clean URL sharing.

The output MUST be a valid JSON object strictly matching this schema:
{
  "slug": "kebab-case-latin-slug",
  "en": {
    "title": "Journalistic headline in English (max 255 chars)",
    "summary": "Executive summary deck explaining the core development",
    "content": "Article body in English markdown with inline citations [^1] (600-1200 words)",
    "keyTakeaways": ["Key bullet 1", "Key bullet 2", "Key bullet 3"]
  },
  "bn": {
    "title": "Journalistic headline in Bengali (max 255 chars)",
    "summary": "Executive summary deck in Bengali",
    "content": "Article body in Bengali markdown with inline citations [^1] (substantive depth)",
    "keyTakeaways": ["Key bullet 1 in Bengali", "Key bullet 2 in Bengali", "Key bullet 3 in Bengali"]
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
${dossierSection}
${sourceContext}
VERIFIED CLAIMS LIST (Citations MUST reference these using inline tags [^1], [^2]):
${claimsContext}

Synthesize the full publication-quality bilingual article draft conforming strictly to the expected schema (target 600–1,200 words in English and equivalent depth in Bengali).`;

    return { systemPrompt, userPrompt };
  } else {
    const systemPrompt = `You are NAKSHATRA's Lead Editorial Journalist and AI Researcher.
Your mandate is to craft an authoritative, in-depth, publication-quality AI journalism article based on the provided VERIFIED CLAIMS and RESEARCH DOSSIER.

TARGET LENGTH: 600 to 1,200 words in English.

EDITORIAL MISSION & TONE:
- Deep, rigorous, beginner-friendly technical journalism. Think Quanta Magazine meets Ars Technica.
- Explain the 'how' and 'why', not just the 'what'. Deconstruct technical mechanics, architectural principles, and real-world implications clearly so non-specialists understand the breakthrough without diluting technical precision.
- Grounded & Objective: Base all claims, numbers, quotes, and attributions on the provided evidence. DO NOT hallucinate benchmarks, dates, or specifications that do not exist.
- No Fluff: Avoid vapid PR cliches ('In the fast-evolving world of AI...', 'A groundbreaking milestone that changes everything...'). Every paragraph must deliver concrete technical explanation or analytical insight.
- Plagiarism Safety: Synthesize entirely in your own original journalistic words. Do not copy multi-word phrases verbatim from sources.

REQUIRED ARTICLE STRUCTURE (Use markdown headings):
# Headline: Clear, active voice, informative, max 255 chars.
Opening Deck: Substantive summary paragraph explaining the core development and context.
## What Happened: Detailed account of the release, model availability, licensing/access tiers.
## Architecture & Technical Mechanics: Dive under the hood. Explain the model architecture, training methodologies (RLHF, reasoning tokens, synthetic data, distillation, mixture-of-experts), context windows, parameter scale, or system design. Explain how the underlying technique works in accessible terms.
## Performance & Benchmarks: Detail reported benchmark results (MMLU, MATH, SWE-bench, HumanEval, latency/throughput). If specific scores are in evidence, cite them accurately with footnotes [^N]. If benchmarks have not been disclosed, state explicitly what evaluation data is known and what remains unverified.
## Background & Industry Context: Historical context. What problem does this solve? How does this compare to previous models or competitor architectures?
## Limitations, Safety & Practical Constraints: Critical analysis of known failure modes, compute/cost demands, safety evaluations, availability restrictions, or open questions.
## The Bottom Line: Strategic takeaway for developers, enterprises, and the AI ecosystem.

INLINE CITATION PROTOCOL:
- Every factual assertion, technical metric, benchmark, or quote MUST include an inline citation tag like [^1], [^2].
- Distribute citations across all sections.
- Every citation [^N] must correspond to an entry in the 'citations' array, where claimIndex is the 0-based index in the VERIFIED CLAIMS list.

The output MUST be a valid JSON object strictly matching this schema:
{
  "title": "string (Journalistic headline, max 255 chars)",
  "deck": "string (Summary deck / subhead explaining the core development, max 500 chars)",
  "slug": "string (URL-friendly kebab-case Latin slug)",
  "contentMarkdown": "string (Article body in markdown with inline [^1] citations, 600-1200 words)",
  "metaDescription": "string (SEO description under 250 chars)",
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
${dossierSection}
${sourceContext}
VERIFIED CLAIMS LIST (Citations MUST reference these using inline tags [^1], [^2]):
${claimsContext}

Synthesize the full publication-quality article draft conforming strictly to the expected schema (target 600–1,200 words in English).`;

    return { systemPrompt, userPrompt };
  }
}

export function sanitizeAndGroundCitations(
  citations: Array<{ citationIndex: number; claimIndex: number; anchorText?: string; primarySourceUrl?: string; sourcePublisher?: string }>,
  claims: VerifiedClaimInput[]
) {
  const valid = (citations || []).filter(
    (c) =>
      typeof c.claimIndex === 'number' &&
      c.claimIndex >= 0 &&
      c.claimIndex < claims.length &&
      Boolean(claims[c.claimIndex])
  );

  const sanitized = valid.map((c, idx) => ({
    citationIndex: c.citationIndex || idx + 1,
    claimIndex: c.claimIndex,
    anchorText: c.anchorText || claims[c.claimIndex]?.sourcePublisher || 'Source',
    primarySourceUrl: c.primarySourceUrl || claims[c.claimIndex]?.primarySourceUrl || 'https://nakshatra.ai',
    sourcePublisher: c.sourcePublisher || claims[c.claimIndex]?.sourcePublisher || 'Verified Source',
  }));

  if (sanitized.length === 0 && claims.length > 0) {
    sanitized.push({
      citationIndex: 1,
      claimIndex: 0,
      anchorText: claims[0].sourcePublisher || 'Primary Source',
      primarySourceUrl: claims[0].primarySourceUrl || 'https://nakshatra.ai',
      sourcePublisher: claims[0].sourcePublisher || 'Primary Source',
    });
  }
  return sanitized;
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

  async synthesizeArticle(params: SynthesisAgentInput): Promise<SynthesisResult> {
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

    const { systemPrompt, userPrompt } = buildSynthesisPrompts(params, false);

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
      draft.citations = sanitizeAndGroundCitations(draft.citations, params.verifiedClaims);

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
    } catch (err) {
      if (runId) {
        await this.logger.finishRun(runId, {
          status: 'failed',
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: Date.now() - startTime,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
  }

  async synthesizeBilingualArticle(params: SynthesisAgentInput): Promise<BilingualSynthesisResult> {
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

    const { systemPrompt, userPrompt } = buildSynthesisPrompts(params, true);

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
      const sanitizedCitations = sanitizeAndGroundCitations(response.data.citations || [], params.verifiedClaims);

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
        citations: sanitizedCitations,
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
        metaDescription: bilingualDraft.en.summary.slice(0, 250),
        citations: sanitizedCitations,
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
    } catch (err) {
      if (runId) {
        await this.logger.finishRun(runId, {
          status: 'failed',
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: Date.now() - startTime,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
  }
}
