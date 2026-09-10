import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';
import { ClaimExtractionAgent } from '../../services/research/claim-extractor';
import { FactVerificationAgent, SourceDocument } from '../../services/research/fact-verifier';
import { AiModelProvider } from '../../services/ai/provider';
import { getAiProvider } from '../../services/ai/factory';
import { AgentAuditLogger } from '../../services/research/audit-logger';
import { extractCleanMarkdown } from '../services/external-research';
import {
  StructuredEvidenceDetails,
  StrictVerifiedClaim,
  normalizeVerifiedClaim,
} from '../../services/editorial/synthesis-agent';

export { type StructuredEvidenceDetails, type StrictVerifiedClaim } from '../../services/editorial/synthesis-agent';

export interface SourceInput {
  title: string;
  url: string;
  text: string;
  sourceName?: string;
  sourceTier?: string;
  extractionStatus?: 'jina_extracted' | 'fallback_rss' | 'raw';
  retrievalStatus?: 'success' | 'fallback' | 'failed';
  retrievedAt?: string;
  provenance?: string;
}

export interface EvidencePacket {
  storyId: string;
  primarySources: SourceInput[];
  secondarySources: SourceInput[];
  confirmedFacts: string[];
  differingPerspectives: string[];
  structuredDetails?: StructuredEvidenceDetails;
  category?: string;
  verifiedClaimsList?: StrictVerifiedClaim[];
}

const OFFICIAL_LAB_DOMAINS = [
  'openai.com',
  'anthropic.com',
  'deepmind.google',
  'ai.google',
  'arxiv.org',
  'ai.meta.com',
  'meta.com',
  'nvidia.com',
  'mistral.ai',
  'cohere.com',
  'huggingface.co',
  'microsoft.com',
];

export function isOfficialLabOrTier1(src: { sourceTier?: string | null; url?: string; sourceName?: string }): boolean {
  if (src.sourceTier === 'tier_1_primary') return true;
  const u = (src.url || '').toLowerCase();
  const n = (src.sourceName || '').toLowerCase();
  return (
    OFFICIAL_LAB_DOMAINS.some((domain) => u.includes(domain)) ||
    ['openai', 'anthropic', 'deepmind', 'meta ai', 'nvidia', 'arxiv', 'google research'].some((lab) => n.includes(lab))
  );
}

export function buildStructuredEvidence(params: {
  storyTitle: string;
  primarySources: SourceInput[];
  secondarySources: SourceInput[];
  verifiedClaimsWithTypes: Array<{ claimText: string; claimType: string; isPrimary: boolean; isConfirmed: boolean }>;
  differingPerspectives: string[];
}): StructuredEvidenceDetails {
  const { storyTitle, primarySources, secondarySources, verifiedClaimsWithTypes, differingPerspectives } = params;

  const pSrc = primarySources[0];
  const sSrc = secondarySources[0];
  const primaryText = pSrc?.text || '';

  // 1. What Happened / Core Announcement
  const releaseClaims = verifiedClaimsWithTypes.filter((c) => c.claimType === 'product_release');
  let whatHappened = releaseClaims.map((c) => c.claimText).join(' ');
  if (!whatHappened) {
    whatHappened = pSrc?.title ? `${pSrc.title}. ${primaryText.slice(0, 300).trim()}` : storyTitle;
  }

  // 2. Technical Details & Mechanics
  const archClaims = verifiedClaimsWithTypes.filter((c) => c.claimType === 'architecture');
  let technicalDetails = archClaims.map((c) => c.claimText).join(' ');
  if (!technicalDetails) {
    const techSentences = primaryText
      .split(/(?<=[.?!])\s+/)
      .filter((s) =>
        /(?:architecture|parameter|context window|weights|transformer|token|latency|inference|training|reasoning|dataset|fine-tun|distill)/i.test(s)
      )
      .slice(0, 4);
    technicalDetails = techSentences.join(' ') || 'Architecture details and technical mechanics reported in release documentation.';
  }

  // 3. Capabilities & Features
  const capabilitiesAndFeatures: string[] = [];
  for (const c of verifiedClaimsWithTypes) {
    if (c.claimType === 'product_release' || c.claimType === 'architecture') {
      if (!capabilitiesAndFeatures.includes(c.claimText)) {
        capabilitiesAndFeatures.push(c.claimText);
      }
    }
  }
  if (capabilitiesAndFeatures.length < 2 && primaryText) {
    const featureLines = primaryText
      .split('\n')
      .map((l) => l.trim().replace(/^[-*•]\s+/, ''))
      .filter((l) => l.length > 25 && l.length < 200 && /(?:support|feature|enabl|capab|allow|provid|accelerat)/i.test(l))
      .slice(0, 3);
    for (const fl of featureLines) {
      if (!capabilitiesAndFeatures.includes(fl)) {
        capabilitiesAndFeatures.push(fl);
      }
    }
  }

  // 4. Benchmarks & Results
  const benchmarkClaims = verifiedClaimsWithTypes.filter((c) => c.claimType === 'benchmark_result');
  const benchmarksAndResults: string[] = benchmarkClaims.map((c) => c.claimText);
  if (benchmarksAndResults.length === 0 && primaryText) {
    const benchSentences = primaryText
      .split(/(?<=[.?!])\s+/)
      .filter((s) =>
        /(?:benchmark|mmlu|gsm8k|humaneval|swe-bench|evaluat|score|percent|%|accuracy|outperform|state-of-the-art|sota)/i.test(s)
      )
      .slice(0, 3);
    for (const bs of benchSentences) {
      if (!benchmarksAndResults.includes(bs.trim())) {
        benchmarksAndResults.push(bs.trim());
      }
    }
  }

  // 5. Background & Context
  let backgroundAndContext = differingPerspectives.join(' ');
  if (!backgroundAndContext && sSrc?.text) {
    backgroundAndContext = sSrc.text.slice(0, 400).trim();
  }
  if (!backgroundAndContext) {
    backgroundAndContext = `Industry context surrounding ${storyTitle} and the ongoing evolution of frontier generative AI systems.`;
  }

  // 6. Limitations & Caveats
  const safetyClaims = verifiedClaimsWithTypes.filter((c) => c.claimType === 'policy_or_safety');
  const limitationsAndCaveats: string[] = safetyClaims.map((c) => c.claimText);
  if (limitationsAndCaveats.length === 0 && primaryText) {
    const limitSentences = primaryText
      .split(/(?<=[.?!])\s+/)
      .filter((s) =>
        /(?:limitat|risk|safety|red-team|cost|pricing|compute|failure|restrict|preview|guardrail)/i.test(s)
      )
      .slice(0, 2);
    for (const ls of limitSentences) {
      if (!limitationsAndCaveats.includes(ls.trim())) {
        limitationsAndCaveats.push(ls.trim());
      }
    }
  }

  // 7. Quotes & Statements
  const quoteClaims = verifiedClaimsWithTypes.filter((c) => c.claimType === 'quote');
  const quotesAndStatements: string[] = quoteClaims.map((c) => c.claimText);
  if (quotesAndStatements.length === 0 && primaryText) {
    const quoteMatches = primaryText.match(/"([^"]{20,160})"/g) || [];
    for (const q of quoteMatches.slice(0, 2)) {
      quotesAndStatements.push(q.replace(/^"|"$/g, ''));
    }
  }

  // 8. Industry Significance
  const industrySignificance = `${storyTitle} represents an impactful development for developers, researchers, and enterprise deployments across the global AI ecosystem.`;

  return {
    whatHappened,
    technicalDetails,
    capabilitiesAndFeatures,
    benchmarksAndResults,
    backgroundAndContext,
    limitationsAndCaveats,
    quotesAndStatements,
    industrySignificance,
  };
}

export class MultiSourceResearcherAgent {
  private claimExtractor: ClaimExtractionAgent;
  private factVerifier: FactVerificationAgent;
  private logger: AgentAuditLogger;

  constructor(aiProvider?: AiModelProvider, logger?: AgentAuditLogger) {
    const provider = aiProvider || getAiProvider();
    this.logger = logger || new AgentAuditLogger();
    this.claimExtractor = new ClaimExtractionAgent(provider, this.logger);
    this.factVerifier = new FactVerificationAgent(provider, this.logger);
  }

  /**
   * Builds an EvidencePacket aggregating primary and secondary sources for a given story_id
   */
  async buildEvidencePacket(storyId: string): Promise<EvidencePacket> {
    const db = await getDb();

    // 1. Fetch story
    const [story] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, storyId))
      .limit(1);

    if (!story) {
      throw new Error(`Story with id ${storyId} not found.`);
    }

    // 2. Fetch all linked raw articles via story_sources
    const linkedSources = await db
      .select({
        isPrimary: schema.storySources.isPrimary,
        rawArticleId: schema.rawArticles.id,
        title: schema.rawArticles.title,
        cleanText: schema.rawArticles.cleanText,
        canonicalUrl: schema.rawArticles.canonicalUrl,
        sourceName: schema.sources.name,
        sourceTier: schema.sources.tier,
      })
      .from(schema.storySources)
      .innerJoin(schema.rawArticles, eq(schema.storySources.rawArticleId, schema.rawArticles.id))
      .innerJoin(schema.sources, eq(schema.rawArticles.sourceId, schema.sources.id))
      .where(eq(schema.storySources.storyId, storyId));

    if (linkedSources.length === 0) {
      throw new Error(`Story ${storyId} has no linked source articles in story_sources.`);
    }

    const primarySources: SourceInput[] = [];
    const secondarySources: SourceInput[] = [];

    for (const item of linkedSources) {
      const srcInput: SourceInput = {
        title: item.title,
        url: item.canonicalUrl,
        text: item.cleanText,
        sourceName: item.sourceName,
        sourceTier: item.sourceTier,
      };

      if (item.isPrimary) {
        primarySources.push(srcInput);
      } else {
        secondarySources.push(srcInput);
      }
    }

    // Source Prioritization:
    // If an official lab source exists in secondarySources while primarySources has none, promote it
    const primaryHasOfficial = primarySources.some((s) => isOfficialLabOrTier1(s));
    if (!primaryHasOfficial) {
      const officialSecIndex = secondarySources.findIndex((s) => isOfficialLabOrTier1(s));
      if (officialSecIndex >= 0) {
        primarySources.unshift(secondarySources.splice(officialSecIndex, 1)[0]);
      }
    }

    // Fallback if none marked primary: make first one primary
    if (primarySources.length === 0 && secondarySources.length > 0) {
      primarySources.push(secondarySources.shift()!);
    }

    // Sort primary sources so official lab sources appear first
    primarySources.sort((a, b) => {
      const aOfficial = isOfficialLabOrTier1(a) ? 1 : 0;
      const bOfficial = isOfficialLabOrTier1(b) ? 1 : 0;
      return bOfficial - aOfficial;
    });

    // Deep Primary Source Enrichment:
    // Treat RSS as discovery metadata: attempt Jina Reader extraction from canonical URL
    // regardless of RSS description length. Keep RSS text as fallback if extraction fails.
    for (const pSrc of primarySources) {
      if (pSrc.url && pSrc.url.startsWith('http')) {
        const originalRssText = pSrc.text || '';
        pSrc.retrievedAt = new Date().toISOString();
        try {
          const fullMarkdown = await extractCleanMarkdown(pSrc.url, originalRssText);
          if (fullMarkdown && fullMarkdown.trim().length > 0) {
            pSrc.text = fullMarkdown;
            pSrc.extractionStatus = 'jina_extracted';
            pSrc.retrievalStatus = 'success';
            pSrc.provenance = `Jina Reader extracted from ${pSrc.url}`;
          } else {
            pSrc.text = originalRssText;
            pSrc.extractionStatus = 'fallback_rss';
            pSrc.retrievalStatus = 'fallback';
            pSrc.provenance = `RSS feed fallback from ${pSrc.url}`;
          }
        } catch {
          // Keep RSS text as fallback only when primary extraction fails
          pSrc.text = originalRssText;
          pSrc.extractionStatus = 'fallback_rss';
          pSrc.retrievalStatus = 'fallback';
          pSrc.provenance = `RSS feed fallback from ${pSrc.url}`;
        }
      } else {
        pSrc.extractionStatus = 'raw';
        pSrc.retrievalStatus = 'fallback';
        pSrc.provenance = 'Direct raw text';
      }
    }

    // Also enrich secondary sources if HTTP URL is available
    for (const sSrc of secondarySources.slice(0, 2)) {
      if (sSrc.url && sSrc.url.startsWith('http')) {
        const originalText = sSrc.text || '';
        sSrc.retrievedAt = new Date().toISOString();
        try {
          const fullMarkdown = await extractCleanMarkdown(sSrc.url, originalText);
          if (fullMarkdown && fullMarkdown.trim().length > 0) {
            sSrc.text = fullMarkdown;
            sSrc.extractionStatus = 'jina_extracted';
            sSrc.retrievalStatus = 'success';
            sSrc.provenance = `Jina Reader extracted from ${sSrc.url}`;
          } else {
            sSrc.text = originalText;
            sSrc.extractionStatus = 'fallback_rss';
            sSrc.retrievalStatus = 'fallback';
            sSrc.provenance = `Secondary metadata fallback from ${sSrc.url}`;
          }
        } catch {
          sSrc.text = originalText;
          sSrc.extractionStatus = 'fallback_rss';
          sSrc.retrievalStatus = 'fallback';
          sSrc.provenance = `Secondary metadata fallback from ${sSrc.url}`;
        }
      }
    }

    // 3. Extract claims from primary and secondary sources
    const allClaimsToVerify: Array<{
      claimId: string;
      claimText: string;
      claimType: string;
      isFromPrimary: boolean;
      sourceUrl: string;
      sourceTitle: string;
      sourceType: string;
      evidenceExcerpt: string;
    }> = [];

    for (const pSrc of primarySources) {
      try {
        const { claims } = await this.claimExtractor.extractClaims({
          articleTitle: pSrc.title,
          articleText: pSrc.text,
          sourceName: pSrc.sourceName || 'Primary Source',
        });
        for (const c of claims) {
          allClaimsToVerify.push({
            claimId: `claim-p-${allClaimsToVerify.length + 1}`,
            claimText: c.claimText,
            claimType: c.claimType,
            isFromPrimary: true,
            sourceUrl: pSrc.url,
            sourceTitle: pSrc.sourceName || pSrc.title || 'Primary Source',
            sourceType: pSrc.sourceTier || 'tier_1_primary',
            evidenceExcerpt: c.sourceExcerpt || c.claimText,
          });
        }
      } catch {
        // Fallback gracefully
      }
    }

    for (const sSrc of secondarySources) {
      try {
        const { claims } = await this.claimExtractor.extractClaims({
          articleTitle: sSrc.title,
          articleText: sSrc.text,
          sourceName: sSrc.sourceName || 'Secondary Source',
        });
        for (const c of claims) {
          allClaimsToVerify.push({
            claimId: `claim-s-${allClaimsToVerify.length + 1}`,
            claimText: c.claimText,
            claimType: c.claimType,
            isFromPrimary: false,
            sourceUrl: sSrc.url,
            sourceTitle: sSrc.sourceName || sSrc.title || 'Secondary Source',
            sourceType: sSrc.sourceTier || 'tier_2_verified',
            evidenceExcerpt: c.sourceExcerpt || c.claimText,
          });
        }
      } catch {
        // Fallback gracefully
      }
    }

    // 4. Verify claims against primary sources
    const primaryDocs: SourceDocument[] = primarySources.map((ps, idx) => ({
      id: `primary-${idx}`,
      url: ps.url,
      sourceName: ps.sourceName || 'Primary Lab Announcement',
      sourceTier: (ps.sourceTier as SourceDocument['sourceTier']) || 'tier_1_primary',
      text: ps.text,
    }));

    const confirmedFacts: string[] = [];
    const differingPerspectives: string[] = [];
    const verifiedClaimsWithTypes: Array<{
      claimText: string;
      claimType: string;
      isPrimary: boolean;
      isConfirmed: boolean;
    }> = [];
    const verifiedClaimsList: StrictVerifiedClaim[] = [];

    if (allClaimsToVerify.length > 0 && primaryDocs.length > 0) {
      try {
        const verifiedOutcomes = await this.factVerifier.verifyClaimsGraph({
          claims: allClaimsToVerify.map((c) => ({ claimText: c.claimText, claimType: c.claimType })),
          sources: primaryDocs,
        });

        for (let i = 0; i < verifiedOutcomes.length; i++) {
          const outcome = verifiedOutcomes[i];
          const claimMeta = allClaimsToVerify[i];
          const isConfirmed = outcome.verificationStatus.startsWith('verified');

          if (isConfirmed) {
            confirmedFacts.push(outcome.claimText);
            verifiedClaimsList.push(
              normalizeVerifiedClaim({
                claimId: claimMeta.claimId,
                claimText: outcome.claimText,
                sourceUrl: claimMeta.sourceUrl,
                sourceTitle: claimMeta.sourceTitle,
                sourceType: claimMeta.sourceType,
                evidenceExcerpt: outcome.evidences[0]?.verbatimExcerpt || claimMeta.evidenceExcerpt,
                epistemicClass: 'FACT',
                confidenceScore: outcome.confidenceScore ?? 0.95,
              })
            );
          } else if (
            outcome.verificationStatus === 'disputed' ||
            outcome.verificationStatus === 'debunked' ||
            outcome.verificationStatus === 'unverified' ||
            !claimMeta?.isFromPrimary
          ) {
            differingPerspectives.push(outcome.claimText);
            verifiedClaimsList.push(
              normalizeVerifiedClaim({
                claimId: claimMeta.claimId,
                claimText: outcome.claimText,
                sourceUrl: claimMeta.sourceUrl,
                sourceTitle: claimMeta.sourceTitle,
                sourceType: claimMeta.sourceType,
                evidenceExcerpt: outcome.evidences[0]?.verbatimExcerpt || claimMeta.evidenceExcerpt,
                epistemicClass: 'ANALYSIS',
                confidenceScore: outcome.confidenceScore ?? 0.85,
              })
            );
          }

          verifiedClaimsWithTypes.push({
            claimText: outcome.claimText,
            claimType: claimMeta?.claimType || 'product_release',
            isPrimary: claimMeta?.isFromPrimary ?? true,
            isConfirmed,
          });
        }
      } catch {
        // Fallback
      }
    }

    // If no claims extracted or verified, populate with titles/summaries
    if (confirmedFacts.length === 0) {
      for (let idx = 0; idx < primarySources.length; idx++) {
        const p = primarySources[idx];
        if (p.text && p.text.trim().length > 0) {
          confirmedFacts.push(p.title);
          verifiedClaimsWithTypes.push({
            claimText: p.title,
            claimType: 'product_release',
            isPrimary: true,
            isConfirmed: true,
          });
          verifiedClaimsList.push(
            normalizeVerifiedClaim({
              claimId: `claim-p-fallback-${idx + 1}`,
              claimText: p.title,
              sourceUrl: p.url,
              sourceTitle: p.sourceName || 'Primary Lab',
              sourceType: p.sourceTier || 'tier_1_primary',
              evidenceExcerpt: p.text.slice(0, 300),
              epistemicClass: 'FACT',
              confidenceScore: 0.90,
            })
          );
        }
      }
    }

    if (differingPerspectives.length === 0) {
      for (let idx = 0; idx < secondarySources.length; idx++) {
        const s = secondarySources[idx];
        if (s.title && s.title !== primarySources[0]?.title) {
          differingPerspectives.push(s.title);
          verifiedClaimsWithTypes.push({
            claimText: s.title,
            claimType: 'quote',
            isPrimary: false,
            isConfirmed: false,
          });
          verifiedClaimsList.push(
            normalizeVerifiedClaim({
              claimId: `claim-s-fallback-${idx + 1}`,
              claimText: s.title,
              sourceUrl: s.url,
              sourceTitle: s.sourceName || 'Industry Perspective',
              sourceType: s.sourceTier || 'tier_2_verified',
              evidenceExcerpt: s.text.slice(0, 300),
              epistemicClass: 'CONTEXT',
              confidenceScore: 0.85,
            })
          );
        }
      }
    }

    const structuredDetails = buildStructuredEvidence({
      storyTitle: story.title,
      primarySources,
      secondarySources,
      verifiedClaimsWithTypes,
      differingPerspectives,
    });

    return {
      storyId,
      primarySources,
      secondarySources,
      confirmedFacts: Array.from(new Set(confirmedFacts)),
      differingPerspectives: Array.from(new Set(differingPerspectives)),
      structuredDetails,
      category: story.category || 'llm_release',
      verifiedClaimsList,
    };
  }
}
