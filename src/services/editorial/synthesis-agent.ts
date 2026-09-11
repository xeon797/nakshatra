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

export type EpistemicClass = 'FACT' | 'CONTEXT' | 'ANALYSIS';

export class GroundingValidationError extends Error {
  constructor(message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = 'GroundingValidationError';
  }
}

export class BilingualParityError extends Error {
  constructor(message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = 'BilingualParityError';
  }
}

export interface StrictVerifiedClaim {
  claimId: string;
  claimText: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceType: string;
  evidenceExcerpt: string;
  epistemicClass: EpistemicClass;
  confidenceScore: number;
  id: string;
  claimType: string;
  primarySourceUrl: string;
  sourcePublisher: string;
  verbatimExcerpt: string;
}

export interface VerifiedClaimInput {
  claimText: string;
  confidenceScore?: number;
  claimId?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceType?: string;
  evidenceExcerpt?: string;
  epistemicClass?: EpistemicClass;
  // Aliases for backwards compatibility with existing code/tests
  id?: string;
  claimType?: string;
  primarySourceUrl?: string;
  sourcePublisher?: string;
  verbatimExcerpt?: string;
}

export function normalizeVerifiedClaim(input: VerifiedClaimInput): StrictVerifiedClaim {
  const claimId = input.claimId || input.id || `claim-${Math.random().toString(36).substring(2, 9)}`;
  const sourceUrl = input.sourceUrl || input.primarySourceUrl || 'https://nakshatra.ai';
  const sourceTitle = input.sourceTitle || input.sourcePublisher || 'Verified Source';
  const sourceType = input.sourceType || input.claimType || 'tier_1_primary';
  const evidenceExcerpt = input.evidenceExcerpt || input.verbatimExcerpt || input.claimText;
  const epistemicClass: EpistemicClass = input.epistemicClass || (
    /(?:benchmark|score|mmlu|swe-bench|percent|%|token|parameter|release|unveil|launch|achieve|latency)/i.test(input.claimText)
      ? 'FACT'
      : /(?:history|previous|earlier|context|traditional|prior|ecosystem)/i.test(input.claimText)
        ? 'CONTEXT'
        : 'FACT'
  );
  const confidenceScore = input.confidenceScore ?? 0.95;

  return {
    claimId,
    claimText: input.claimText,
    sourceUrl,
    sourceTitle,
    sourceType,
    evidenceExcerpt,
    epistemicClass,
    confidenceScore,
    id: claimId,
    claimType: sourceType,
    primarySourceUrl: sourceUrl,
    sourcePublisher: sourceTitle,
    verbatimExcerpt: evidenceExcerpt,
  };
}

export interface EditorialSectionDefinition {
  enHeading: string;
  bnHeading: string;
  description: string;
  epistemicClass: EpistemicClass;
}

export interface CategoryEditorialTemplate {
  category: string;
  titleGuidance: string;
  sections: EditorialSectionDefinition[];
}

export const CATEGORY_EDITORIAL_TEMPLATES: Record<string, CategoryEditorialTemplate> = {
  llm_release: {
    category: 'llm_release',
    titleGuidance: 'Active-voice journalistic headline highlighting model family, parameter scale, key architectural advance, or core capability.',
    sections: [
      {
        enHeading: 'What Happened',
        bnHeading: 'মূল ঘোষণা ও প্রেক্ষাপট',
        description: 'Core release announcement, model variants, licensing (open-weights vs proprietary API), release timeline, and accessibility tiers.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'Architecture & Technical Mechanics',
        bnHeading: 'আর্কিটেকচার ও প্রযুক্তিগত কার্যপ্রণালী',
        description: 'Under-the-hood engineering: transformer architecture, attention mechanisms (e.g. MLA/MQA), context window capacity, training dataset mixture, reasoning token mechanisms, or quantization format.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'Performance & Benchmarks',
        bnHeading: 'কর্মক্ষমতা ও বেঞ্চমার্ক ফলাফল',
        description: 'Empirical benchmark evaluations (MMLU, MATH, HumanEval, SWE-bench, latency/throughput). Cite verified scores with footnotes [^N]; state clearly what metrics remain unverified or self-reported.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'Background & Industry Context',
        bnHeading: 'পটভূমি ও প্রযুক্তি বিশ্বের প্রেক্ষাপট',
        description: 'Historical lineage, comparisons to predecessor models and competitor frontier systems. Industry landscape dynamics.',
        epistemicClass: 'CONTEXT',
      },
      {
        enHeading: 'Limitations, Safety & Practical Constraints',
        bnHeading: 'সীমাবদ্ধতা, সুরক্ষা ও ব্যবহারিক চ্যালেঞ্জ',
        description: 'Known failure modes, red-teaming evaluations, safety guardrails (ASL tiers, responsible scaling), API pricing, rate limits, and hardware deployment requirements.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'The Bottom Line',
        bnHeading: 'সামগ্রিক মূল্যায়ন ও ভবিষ্যতের পথরেখা',
        description: 'Strategic synthesis for developers, enterprise decision makers, and the open-source community. Must be framed analytically, not as ungrounded empirical prophecy.',
        epistemicClass: 'ANALYSIS',
      },
    ],
  },
  agentic: {
    category: 'agentic',
    titleGuidance: 'Active-voice journalistic headline highlighting agent framework, reasoning loop, autonomy level, or tool execution breakthrough.',
    sections: [
      {
        enHeading: 'Autonomous Framework Overview',
        bnHeading: 'স্বায়ত্তশাসিত ফ্রেমওয়ার্ক পরিচিতি',
        description: 'Agent architecture, core design pattern (ReAct, plan-and-solve, multi-agent orchestration), execution runtime, and autonomy scope.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'Tool Use & Execution Architecture',
        bnHeading: 'টুল ব্যবহার ও এক্সিকিউশন আর্কিটেকচার',
        description: 'How the agent interacts with external environments: tool calling protocols, API integration, sandboxed code execution, memory management, and feedback loops.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'Reasoning Traces & Decision Benchmarks',
        bnHeading: 'রিজনিং ট্রেস ও কার্যক্ষমতা বেঞ্চমার্ক',
        description: 'Empirical evaluations on agentic benchmarks (SWE-bench, WebArena, GAIA, ToolBench), task success rates, context recovery, and error correction efficiency.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'Integration Ecosystem & Workflows',
        bnHeading: 'ইন্টিগ্রেশন ও ওয়ার্কফ্লো ব্যবস্থা',
        description: 'Compatibility with developer stacks, MCP (Model Context Protocol) support, enterprise workflow integration, and real-world deployment cases.',
        epistemicClass: 'CONTEXT',
      },
      {
        enHeading: 'Safety, Guardrails & Autonomy Risks',
        bnHeading: 'নিরাপত্তা, নিয়ন্ত্রণ ও অটোনমি ঝুঁকি',
        description: 'Human-in-the-loop controls, permission boundary enforcement, prompt injection defense, runaway loop mitigation, and systemic safety constraints.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'The Bottom Line',
        bnHeading: 'সামগ্রিক মূল্যায়ন ও ভবিষ্যতের পথরেখা',
        description: 'Strategic analysis on how this agentic advance shifts developer workflows and autonomous software engineering.',
        epistemicClass: 'ANALYSIS',
      },
    ],
  },
  infra: {
    category: 'infra',
    titleGuidance: 'Journalistic headline detailing hardware compute, datacenter interconnect, serving throughput, or cluster efficiency advance.',
    sections: [
      {
        enHeading: 'Compute & Hardware Milestone',
        bnHeading: 'কম্পিউট ও হার্ডওয়্যার পরিকাঠামো',
        description: 'Hardware specifications, accelerator silicon (GPU/TPU/ASIC), memory architecture (HBM3e/SRAM), fabrication node, and compute density.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'Scalability, Throughput & Memory Bandwidth',
        bnHeading: 'স্কেলেবিলিটি, থ্রুপুট ও মেমরি ব্যান্ডউইডথ',
        description: 'Interconnect bandwidth (NVLink, Ultra Ethernet), network topology, distributed scaling efficiency, tokens-per-second throughput, and KV-cache offloading.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'Efficiency & Serving Economics',
        bnHeading: 'সাশ্রয়ী সক্ষমতা ও সার্ভিং ইকোনমিক্স',
        description: 'Total Cost of Ownership (TCO), energy efficiency (FLOPs/Watt), inference serving cost per million tokens, and quantization optimizations (FP8/FP4).',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'Datacenter & Cloud Architecture',
        bnHeading: 'ডেটাসেন্টার ও ক্লাউড আর্কিটেকচার',
        description: 'Datacenter cooling (liquid vs air), power infrastructure limits, availability across hyperscalers (AWS, Azure, GCP, CoreWeave), and deployment footprint.',
        epistemicClass: 'CONTEXT',
      },
      {
        enHeading: 'Bottlenecks & Operational Constraints',
        bnHeading: 'সিস্টেম প্রতিবন্ধকতা ও অপারেশনাল চ্যালেঞ্জ',
        description: 'Supply chain constraints, thermal dissipation barriers, memory wall limitations, software driver stability, and cluster failure recovery.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'The Bottom Line',
        bnHeading: 'সামগ্রিক মূল্যায়ন ও ভবিষ্যতের পথরেখা',
        description: 'Strategic analysis of macro AI compute economics and future infrastructure trajectory.',
        epistemicClass: 'ANALYSIS',
      },
    ],
  },
  research: {
    category: 'research',
    titleGuidance: 'Journalistic headline highlighting theoretical innovation, mathematical insight, algorithmic discovery, or scientific breakthrough.',
    sections: [
      {
        enHeading: 'Theoretical Core & Problem Statement',
        bnHeading: 'তাত্ত্বিক ভিত্তি ও গবেষণা সমস্যা',
        description: 'The fundamental research question, scientific bottleneck in existing paradigms, mathematical formulations, and core hypothesis.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'Methodology & Algorithmic Design',
        bnHeading: 'মেথডোলজি ও অ্যালগরিদমিক ডিজাইন',
        description: 'Detailed explanation of the novel algorithm, loss formulation, objective function, sampling technique, architectural proofs, or synthetic data pipeline.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'Empirical Validation & Ablation Studies',
        bnHeading: 'গবেষণালব্ধ ফলাফল ও অ্যাবলেশন বিশ্লেষণ',
        description: 'Experimental setup, baseline comparisons, statistical rigor, ablation study insights proving which architectural components deliver gains.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'Theoretical Lineage & Prior Art',
        bnHeading: 'পূর্ববর্তী গবেষণা ও তাত্ত্বিক প্রেক্ষাপট',
        description: 'Academic context, foundational papers leading up to this discovery, and contrasting theoretical approaches in the literature.',
        epistemicClass: 'CONTEXT',
      },
      {
        enHeading: 'Assumptions, Limitations & Open Questions',
        bnHeading: 'সীমাবদ্ধতা ও অমীমাংসিত প্রশ্নাবলী',
        description: 'Theoretical bounds, assumptions made in proofs/evaluations, scenarios where the method fails, and open research directions.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'The Bottom Line',
        bnHeading: 'সামগ্রিক মূল্যায়ন ও ভবিষ্যতের পথরেখা',
        description: 'Analytical perspective on the long-term scientific and practical ripple effects of this research.',
        epistemicClass: 'ANALYSIS',
      },
    ],
  },
  policy: {
    category: 'policy',
    titleGuidance: 'Journalistic headline covering legislative action, regulatory framework, antitrust ruling, safety mandate, or international treaty.',
    sections: [
      {
        enHeading: 'Regulatory & Governance Action',
        bnHeading: 'নিয়ন্ত্রক পদক্ষেপ ও নীতিগত সিদ্ধান্ত',
        description: 'Specific legislative provisions, executive orders, regulatory determinations, treaty terms, enforcement bodies, and implementation timeline.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'Enforcement Mechanisms & Compliance Standards',
        bnHeading: 'বাস্তবায়ন পদ্ধতি ও সম্মতি মানদণ্ড',
        description: 'Audit requirements, compute/data reporting thresholds, model registration mandates, red-teaming disclosures, and penalty structures.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'Geopolitical & Economic Ramifications',
        bnHeading: 'ভূ-রাজনৈতিক ও অর্থনৈতিক প্রভাব',
        description: 'Impact on sovereign AI competition, export control regimes, semiconductor trade, market concentration, and startup competitiveness.',
        epistemicClass: 'CONTEXT',
      },
      {
        enHeading: 'Stakeholder Perspectives & Dissent',
        bnHeading: 'বিভিন্ন পক্ষের প্রতিক্রিয়া ও মতামত',
        description: 'Arguments from frontier labs, open-source advocates, civil liberties groups, and academic researchers.',
        epistemicClass: 'CONTEXT',
      },
      {
        enHeading: 'Implementation Hurdles & Legal Gaps',
        bnHeading: 'বাস্তবায়ন চ্যালেঞ্জ ও আইনি জটিলতা',
        description: 'Ambiguities in technical definitions (e.g. compute FLOPS threshold), cross-border jurisdiction conflicts, and enforcement feasibility.',
        epistemicClass: 'FACT',
      },
      {
        enHeading: 'The Bottom Line',
        bnHeading: 'সামগ্রিক মূল্যায়ন ও ভবিষ্যতের পথরেখা',
        description: 'Analytical assessment of how this policy shifts the compliance and innovation landscape.',
        epistemicClass: 'ANALYSIS',
      },
    ],
  },
};

export function getCategoryEditorialTemplate(category?: string): CategoryEditorialTemplate {
  if (category && CATEGORY_EDITORIAL_TEMPLATES[category]) {
    return CATEGORY_EDITORIAL_TEMPLATES[category];
  }
  return CATEGORY_EDITORIAL_TEMPLATES.llm_release;
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
  category?: string;
}

export function buildSynthesisPrompts(params: SynthesisAgentInput, isBilingual = false): {
  systemPrompt: string;
  userPrompt: string;
} {
  const normalizedClaims = params.verifiedClaims.map((c) => normalizeVerifiedClaim(c));
  const claimsContext = normalizedClaims
    .map(
      (c, idx) =>
        `[Claim ${idx}] [${c.epistemicClass || 'FACT'}] (${c.sourceType})\nClaim ID: ${c.claimId}\nClaim: ${c.claimText}\nConfidence: ${c.confidenceScore}\nSource: ${c.sourceTitle} (${c.sourceUrl})\nVerified Excerpt: "${c.evidenceExcerpt}"`
    )
    .join('\n\n');

  const template = getCategoryEditorialTemplate(params.category);
  const enSectionsText = template.sections
    .map((s) => `## ${s.enHeading} [${s.epistemicClass}]: ${s.description}`)
    .join('\n');
  const bnSectionsText = template.sections
    .map((s) => `## ${s.bnHeading}: ${s.description}`)
    .join('\n');

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
  const secondaryRaw = (params.rawSourceTexts[1] || '').trim();
  const primaryContext = primaryRaw
    ? `\nPRIMARY SOURCE REFERENCE MATERIAL (${params.primaryPublisher || 'Primary Source'} - ${params.primarySourceUrl || ''}):\n"""\n${primaryRaw.slice(0, 4000)}\n"""\n`
    : '';
  const secondaryContext = secondaryRaw
    ? `\nSECONDARY EVIDENCE REFERENCE MATERIAL (Industry Analysis, Perspectives & Context):\n"""\n${secondaryRaw.slice(0, 2000)}\n"""\n`
    : '';
  const sourceContext = `${primaryContext}${secondaryContext}`;

  const epistemicTriadInstructions = `
EPISTEMIC TRIAD PROTOCOL (MANDATORY JOURNALISTIC RIGOR):
1. FACT: Direct empirical statements, benchmark scores, specifications, and primary announcements.
   - MUST be strictly grounded in verified claims with inline citations [^N].
   - Never state unverified claims, benchmark figures, or rumours as established facts.
2. CONTEXT: Historical lineage, previous model architectures, comparative baseline background.
   - Must be clearly identified as background context and grounded in evidence.
3. ANALYSIS: Forward-looking implications, strategic interpretation, editorial perspective, or industry synthesis.
   - MUST be explicitly framed with analytical qualifiers (e.g., 'Analysis suggests...', 'From an architectural perspective...', 'Industry observers note...', 'This indicates that...').
   - NEVER state predictions, speculative impact, or subjective interpretations as objective facts without analytical framing.
   - NEVER assign factual citation tags [^N] to purely speculative assertions.`;

  if (isBilingual) {
    const systemPrompt = `You are NAKSHATRA's Lead Bilingual Editorial Journalist and AI Researcher.
Your mandate is to craft an authoritative, comprehensive dual-language news article in English (en) and Bengali (bn) based on the provided VERIFIED CLAIMS and RESEARCH DOSSIER.

TARGET LENGTH: 600 to 1,200 words in English, and equivalent substantive depth in Bengali.
EDITORIAL CATEGORY: ${template.category.toUpperCase()}
HEADLINE GUIDANCE: ${template.titleGuidance}

EDITORIAL MISSION & TONE:
- Deep, rigorous, beginner-friendly technical journalism. Think Quanta Magazine meets Ars Technica.
- Explain the 'how' and 'why', not just the 'what'. Deconstruct technical mechanics, architectural principles, and real-world implications clearly so non-specialists understand the breakthrough without diluting technical precision.
- Grounded & Objective: Base all claims, numbers, quotes, and attributions on the provided evidence. DO NOT hallucinate benchmarks, dates, or specifications that do not exist.
- No Fluff: Avoid vapid PR cliches ('In the fast-evolving world of AI...', 'A groundbreaking milestone that changes everything...'). Every paragraph must deliver concrete technical explanation or analytical insight.
- Plagiarism Safety: Synthesize entirely in your own original journalistic words. Do not copy multi-word phrases verbatim from sources.
${epistemicTriadInstructions}

REQUIRED ARTICLE STRUCTURE (In English markdown content, follow these exact headings):
# Headline
Opening Deck
${enSectionsText}

REQUIRED ARTICLE STRUCTURE (In Bengali markdown content, follow these exact headings):
${bnSectionsText}

BENGALI JOURNALISM DIRECTIVE:
- High-caliber, natural tech Bengali (comparable to Prothom Alo / Anandabazar tech desk).
- Full information parity: Preserves the same facts, metrics, benchmarks, limitations, context, and conclusions as the English version. NEVER produce a lossy 2-sentence summary.
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
EDITORIAL CATEGORY: ${template.category.toUpperCase()}
HEADLINE GUIDANCE: ${template.titleGuidance}

EDITORIAL MISSION & TONE:
- Deep, rigorous, beginner-friendly technical journalism. Think Quanta Magazine meets Ars Technica.
- Explain the 'how' and 'why', not just the 'what'. Deconstruct technical mechanics, architectural principles, and real-world implications clearly so non-specialists understand the breakthrough without diluting technical precision.
- Grounded & Objective: Base all claims, numbers, quotes, and attributions on the provided evidence. DO NOT hallucinate benchmarks, dates, or specifications that do not exist.
- No Fluff: Avoid vapid PR cliches ('In the fast-evolving world of AI...', 'A groundbreaking milestone that changes everything...'). Every paragraph must deliver concrete technical explanation or analytical insight.
- Plagiarism Safety: Synthesize entirely in your own original journalistic words. Do not copy multi-word phrases verbatim from sources.
${epistemicTriadInstructions}

REQUIRED ARTICLE STRUCTURE (Use markdown headings):
# Headline: Clear, active voice, informative, max 255 chars.
Opening Deck: Substantive summary paragraph explaining the core development and context.
${enSectionsText}

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

export interface CitationRemapInput {
  rawCitations: Array<{
    citationIndex?: number;
    claimIndex?: number;
    anchorText?: string;
    primarySourceUrl?: string;
    sourcePublisher?: string;
  }>;
  claims: VerifiedClaimInput[];
  enContent?: string;
  bnContent?: string;
}

export interface CitationRemapResult {
  citations: Array<{
    citationIndex: number;
    claimIndex: number;
    anchorText: string;
    primarySourceUrl: string;
    sourcePublisher: string;
  }>;
  enContent: string;
  bnContent: string;
  unmappedIndices: number[];
}

export function remapAndGroundCitations(params: CitationRemapInput): CitationRemapResult {
  const { rawCitations, claims, enContent = '', bnContent = '' } = params;

  if (!claims || claims.length === 0) {
    throw new GroundingValidationError('Cannot ground citations: No verified claims provided.');
  }

  const normalizedClaims = claims.map((c) => normalizeVerifiedClaim(c));
  const validGroundedCitations: Array<{
    citationIndex: number;
    claimIndex: number;
    anchorText: string;
    primarySourceUrl: string;
    sourcePublisher: string;
  }> = [];
  const unmappedIndices: number[] = [];

  for (const rawCit of rawCitations || []) {
    let resolvedClaimIndex: number | undefined = undefined;

    // 1. Direct index check
    if (
      typeof rawCit.claimIndex === 'number' &&
      rawCit.claimIndex >= 0 &&
      rawCit.claimIndex < normalizedClaims.length &&
      Boolean(normalizedClaims[rawCit.claimIndex])
    ) {
      resolvedClaimIndex = rawCit.claimIndex;
    } else {
      // 2. Deterministic remapping: Match against verified claims
      // A. Match by source URL
      if (rawCit.primarySourceUrl) {
        const citUrl = rawCit.primarySourceUrl.toLowerCase();
        const urlIdx = normalizedClaims.findIndex((c) => {
          const cUrl = c.sourceUrl.toLowerCase();
          return (
            cUrl === citUrl ||
            (cUrl.length > 8 && citUrl.includes(cUrl)) ||
            (citUrl.length > 8 && cUrl.includes(citUrl))
          );
        });
        if (urlIdx >= 0) {
          resolvedClaimIndex = urlIdx;
        }
      }

      // B. Match by anchor text keywords against claim text or excerpt
      if (resolvedClaimIndex === undefined && rawCit.anchorText && rawCit.anchorText.trim().length >= 4) {
        const anchorLower = rawCit.anchorText.trim().toLowerCase();
        const textIdx = normalizedClaims.findIndex((c) => {
          const cText = c.claimText.toLowerCase();
          const cExcerpt = c.evidenceExcerpt.toLowerCase();
          return cText.includes(anchorLower) || cExcerpt.includes(anchorLower) || anchorLower.includes(cText);
        });
        if (textIdx >= 0) {
          resolvedClaimIndex = textIdx;
        }
      }
    }

    if (resolvedClaimIndex !== undefined) {
      const claim = normalizedClaims[resolvedClaimIndex];
      validGroundedCitations.push({
        citationIndex: rawCit.citationIndex || validGroundedCitations.length + 1,
        claimIndex: resolvedClaimIndex,
        anchorText: rawCit.anchorText || claim.sourceTitle || 'Source',
        primarySourceUrl: rawCit.primarySourceUrl || claim.sourceUrl,
        sourcePublisher: rawCit.sourcePublisher || claim.sourceTitle,
      });
    } else {
      // Unmapped / unsupported citation — NEVER default to claim[0]
      if (typeof rawCit.citationIndex === 'number') {
        unmappedIndices.push(rawCit.citationIndex);
      }
    }
  }

  // 3. Strip unmapped citation footnote tokens [^N] from English and Bengali text
  let cleanedEn = enContent;
  let cleanedBn = bnContent;
  for (const idx of unmappedIndices) {
    const tokenRegex = new RegExp(`\\s*\\[\\^${idx}\\]`, 'g');
    cleanedEn = cleanedEn.replace(tokenRegex, '');
    cleanedBn = cleanedBn.replace(tokenRegex, '');
  }

  // 4. Grounding invariant: If 0 valid citations could be grounded, fail validation.
  if (validGroundedCitations.length === 0) {
    throw new GroundingValidationError(
      'Article citation grounding failed: 0 valid citations could be grounded against verified evidence. Unsafe fallback to claim[0] rejected.',
      { rawCitationsCount: (rawCitations || []).length, claimsCount: claims.length, unmappedIndices }
    );
  }

  return {
    citations: validGroundedCitations,
    enContent: cleanedEn,
    bnContent: cleanedBn,
    unmappedIndices,
  };
}

export function sanitizeAndGroundCitations(
  citations: Array<{ citationIndex: number; claimIndex: number; anchorText?: string; primarySourceUrl?: string; sourcePublisher?: string }>,
  claims: VerifiedClaimInput[]
) {
  const result = remapAndGroundCitations({
    rawCitations: citations,
    claims,
  });
  return result.citations;
}

export interface EpistemicValidationResult {
  isValid: boolean;
  violations: string[];
}

export function validateEpistemicSeparation(contentMarkdown: string): EpistemicValidationResult {
  const violations: string[] = [];

  // 1. Check for dogmatic speculative claims presenting as empirical facts without analytical hedging
  const dogmaticSpeculationRegexes = [
    /\b(?:will certainly|guaranteed to|undeniably proves that|unquestionably renders|definitely achieves AGI)\b/i,
    /\b(?:proves that human developers are obsolete|irreversibly replaces all)\b/i,
  ];

  for (const regex of dogmaticSpeculationRegexes) {
    const match = contentMarkdown.match(regex);
    if (match) {
      violations.push(`Dogmatic speculation presented as unhedged fact: "${match[0]}"`);
    }
  }

  // 2. Check for predictive speculation inappropriately tagged with factual citations
  const citedFuturePredictionRegex = /\b(?:by 20\d\d|in the coming decades|in the future|eventually)[\s,]+[^.?!]{0,80}\b(?:will|shall)\b[^.?!]{0,80}\[\^\d+\]/i;
  const predMatch = contentMarkdown.match(citedFuturePredictionRegex);
  if (predMatch) {
    violations.push(`Predictive speculation inappropriately tagged with factual citation: "${predMatch[0]}"`);
  }

  return {
    isValid: violations.length === 0,
    violations,
  };
}

export interface BilingualParityValidationResult {
  isValid: boolean;
  enWordCount: number;
  bnWordCount: number;
  wordCountRatio: number;
  enSectionsCount: number;
  bnSectionsCount: number;
  hasCitationsInBoth: boolean;
  error?: string;
  reasons: string[];
}

export function validateBilingualParity(bilingualDraft: BilingualArticleDraft): BilingualParityValidationResult {
  const enContent = bilingualDraft.en.content || '';
  const bnContent = bilingualDraft.bn.content || '';

  const enWords = enContent.split(/\s+/).filter(Boolean).length;
  const bnWords = bnContent.split(/\s+/).filter(Boolean).length;
  const ratio = enWords > 0 ? bnWords / enWords : 0;

  const enHeadings = (enContent.match(/^##\s+.+$/gm) || []).map((h) => h.replace(/^##\s+/, '').trim());
  const bnHeadings = (bnContent.match(/^##\s+.+$/gm) || []).map((h) => h.replace(/^##\s+/, '').trim());

  const enCitations = (enContent.match(/\[\^\d+\]/g) || []).length;
  const bnCitations = (bnContent.match(/\[\^\d+\]/g) || []).length;

  const reasons: string[] = [];

  // 1. Length parity: Truncated Bengali detection
  if (enWords >= 80) {
    if (bnWords < 40) {
      reasons.push(`Bengali content is severely truncated (${bnWords} words vs ${enWords} English words).`);
    } else if (ratio < 0.25) {
      reasons.push(`Bengali word count ratio too low (${(ratio * 100).toFixed(1)}% < 25%).`);
    }
  }

  // 2. Structural section parity:
  if (enHeadings.length >= 4 && bnHeadings.length < 3) {
    reasons.push(
      `Structural parity failure: Bengali draft has ${bnHeadings.length} sections while English has ${enHeadings.length} sections.`
    );
  }

  // 3. Citation parity:
  if (enCitations > 0 && bnCitations === 0) {
    reasons.push('Citation parity failure: English text contains citations but Bengali text has none.');
  }

  // 4. Key Takeaways parity:
  if (bilingualDraft.en.keyTakeaways.length > 0 && bilingualDraft.bn.keyTakeaways.length === 0) {
    reasons.push('Key takeaways parity failure: English has key takeaways but Bengali has none.');
  }

  const isValid = reasons.length === 0;

  return {
    isValid,
    enWordCount: enWords,
    bnWordCount: bnWords,
    wordCountRatio: ratio,
    enSectionsCount: enHeadings.length,
    bnSectionsCount: bnHeadings.length,
    hasCitationsInBoth: (enCitations > 0 && bnCitations > 0) || (enCitations === 0 && bnCitations === 0),
    error: isValid ? undefined : reasons.join('; '),
    reasons,
  };
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

  public getAiProvider(): AiModelProvider {
    return this.aiProvider;
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
      const remapped = remapAndGroundCitations({
        rawCitations: draft.citations || [],
        claims: params.verifiedClaims,
        enContent: draft.contentMarkdown,
      });
      draft.citations = remapped.citations;
      draft.contentMarkdown = remapped.enContent;

      // Epistemic separation validation
      const epistemicCheck = validateEpistemicSeparation(draft.contentMarkdown);
      if (!epistemicCheck.isValid) {
        throw new GroundingValidationError(
          `Article failed epistemic separation validation: ${epistemicCheck.violations.join('; ')}`
        );
      }

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
          maxTokens: 8192,
        }
      );

      const cleanSlug = ensureLatinSlug(response.data.slug, response.data.en.title);
      const remapped = remapAndGroundCitations({
        rawCitations: response.data.citations || [],
        claims: params.verifiedClaims,
        enContent: response.data.en.content,
        bnContent: response.data.bn.content,
      });

      const bilingualDraft: BilingualArticleDraft = {
        slug: cleanSlug,
        en: {
          title: response.data.en.title,
          summary: response.data.en.summary,
          content: remapped.enContent,
          keyTakeaways: response.data.en.keyTakeaways || [],
        },
        bn: {
          title: response.data.bn.title,
          summary: response.data.bn.summary,
          content: remapped.bnContent,
          keyTakeaways: response.data.bn.keyTakeaways || [],
        },
        citations: remapped.citations,
      };

      // Epistemic separation validation on English body
      const epistemicCheck = validateEpistemicSeparation(bilingualDraft.en.content);
      if (!epistemicCheck.isValid) {
        throw new GroundingValidationError(
          `Article failed epistemic separation validation: ${epistemicCheck.violations.join('; ')}`
        );
      }

      // Bilingual information parity check
      const parityCheck = validateBilingualParity(bilingualDraft);
      if (!parityCheck.isValid) {
        throw new BilingualParityError(
          `Bengali draft failed information parity validation: ${parityCheck.error}`,
          { details: parityCheck }
        );
      }

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
        citations: remapped.citations,
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
