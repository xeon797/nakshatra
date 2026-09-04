import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';
import { ClaimExtractionAgent } from '../../services/research/claim-extractor';
import { FactVerificationAgent, SourceDocument } from '../../services/research/fact-verifier';
import { AiModelProvider } from '../../services/ai/provider';
import { getAiProvider } from '../../services/ai/factory';
import { AgentAuditLogger } from '../../services/research/audit-logger';

export interface SourceInput {
  title: string;
  url: string;
  text: string;
  sourceName?: string;
  sourceTier?: string;
}

export interface EvidencePacket {
  storyId: string;
  primarySources: SourceInput[];
  secondarySources: SourceInput[];
  confirmedFacts: string[];
  differingPerspectives: string[];
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

    // Fallback if none marked primary: make first one primary
    if (primarySources.length === 0 && secondarySources.length > 0) {
      primarySources.push(secondarySources.shift()!);
    }

    // 3. Extract claims from primary and secondary sources
    const allClaimsToVerify: Array<{ claimText: string; claimType: string; isFromPrimary: boolean }> = [];

    for (const pSrc of primarySources) {
      try {
        const { claims } = await this.claimExtractor.extractClaims({
          articleTitle: pSrc.title,
          articleText: pSrc.text,
          sourceName: pSrc.sourceName || 'Primary Source',
        });
        for (const c of claims) {
          allClaimsToVerify.push({ claimText: c.claimText, claimType: c.claimType, isFromPrimary: true });
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
          allClaimsToVerify.push({ claimText: c.claimText, claimType: c.claimType, isFromPrimary: false });
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
      sourceTier: (ps.sourceTier as any) || 'tier_1_primary',
      text: ps.text,
    }));

    const confirmedFacts: string[] = [];
    const differingPerspectives: string[] = [];

    if (allClaimsToVerify.length > 0 && primaryDocs.length > 0) {
      try {
        const verifiedOutcomes = await this.factVerifier.verifyClaimsGraph({
          claims: allClaimsToVerify.map((c) => ({ claimText: c.claimText, claimType: c.claimType })),
          sources: primaryDocs,
        });

        for (let i = 0; i < verifiedOutcomes.length; i++) {
          const outcome = verifiedOutcomes[i];
          const claimMeta = allClaimsToVerify[i];

          if (outcome.verificationStatus.startsWith('verified')) {
            confirmedFacts.push(outcome.claimText);
          } else if (
            outcome.verificationStatus === 'disputed' ||
            outcome.verificationStatus === 'debunked' ||
            outcome.verificationStatus === 'unverified' ||
            !claimMeta?.isFromPrimary
          ) {
            differingPerspectives.push(outcome.claimText);
          }
        }
      } catch {
        // Fallback
      }
    }

    // If no claims extracted or verified, populate with titles/summaries
    if (confirmedFacts.length === 0) {
      for (const p of primarySources) {
        if (p.text && p.text.trim().length > 0) {
          confirmedFacts.push(p.title);
        }
      }
    }

    if (differingPerspectives.length === 0) {
      for (const s of secondarySources) {
        if (s.title && s.title !== primarySources[0]?.title) {
          differingPerspectives.push(s.title);
        }
      }
    }

    return {
      storyId,
      primarySources,
      secondarySources,
      confirmedFacts: Array.from(new Set(confirmedFacts)),
      differingPerspectives: Array.from(new Set(differingPerspectives)),
    };
  }
}
