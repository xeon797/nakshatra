import { getDb, resetDbForTesting } from "../src/db/index.ts";
import { initializeDatabase } from "../src/db/init.ts";
import * as schema from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { seedDefaultSources } from "../src/services/ingestion/seed-sources.ts";
import { ArticleManager } from "../src/services/editorial/article-manager.ts";
import { AgentAuditLogger } from "../src/services/research/audit-logger.ts";

async function main() {
  console.log("?? [NAKSHATRA] Initializing database and demo data...");
  await initializeDatabase();
  await seedDefaultSources();
  const db = await getDb();
  const manager = new ArticleManager();
  const logger = new AgentAuditLogger();

  // 1. Fetch Google DeepMind source
  const [sourceDeepMind] = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.name, "Google DeepMind Research"))
    .limit(1);

  // 2. Fetch Anthropic source
  const [sourceAnthropic] = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.name, "Anthropic Research"))
    .limit(1);

  console.log("?? Seeding Story 1: Claude 3.7 Sonnet Hybrid Reasoning (Published)...");
  const [cluster1] = await db
    .insert(schema.storyClusters)
    .values({
      title: "Anthropic Announces Claude 3.7 Sonnet and Hybrid Reasoning",
      slug: "anthropic-claude-3-7-sonnet-hybrid-reasoning",
      summary: "Anthropic introduces Claude 3.7 Sonnet with dynamic reasoning control.",
      status: "published",
    })
    .returning();

  const [claim1] = await db
    .insert(schema.claims)
    .values({
      storyClusterId: cluster1.id,
      claimText: "Claude 3.7 Sonnet provides hybrid reasoning combining instantaneous and extended thinking.",
      claimType: "architecture",
      verificationStatus: "verified_primary",
      confidenceScore: "0.99",
    })
    .returning();

  await db.insert(schema.evidences).values({
    claimId: claim1.id,
    sourceUrl: "https://www.anthropic.com/news/claude-3-7-sonnet",
    sourceName: "Anthropic Engineering",
    sourceTier: "tier_1_primary",
    verbatimExcerpt: "Claude 3.7 Sonnet is our first hybrid reasoning model, capable of producing near-instant responses or thinking deeply through complex problems.",
    entailment: "supports",
    rationale: "Direct technical confirmation in Anthropic official announcement.",
  });

  const [claim2] = await db
    .insert(schema.claims)
    .values({
      storyClusterId: cluster1.id,
      claimText: "Users and developers can dynamically set thinking budgets from 0 up to 128,000 tokens.",
      claimType: "product_release",
      verificationStatus: "verified_primary",
      confidenceScore: "0.98",
    })
    .returning();

  await db.insert(schema.evidences).values({
    claimId: claim2.id,
    sourceUrl: "https://www.anthropic.com/news/claude-3-7-sonnet",
    sourceName: "Anthropic Engineering",
    sourceTier: "tier_1_primary",
    verbatimExcerpt: "Developers have granular control over thinking budget, tuning reasoning tokens to fit task difficulty and latency constraints.",
    entailment: "supports",
    rationale: "Explicit API capability detailed in model documentation.",
  });

  const synthArticle1 = {
    draft: {
      title: "Anthropic Unveils Claude 3.7 Sonnet with Unified Hybrid Reasoning Architecture",
      deck: "The new flagship allows developers to programmatically dial between sub-second latency and deep, chain-of-thought exploration.",
      slug: "anthropic-unveils-claude-3-7-sonnet-hybrid-reasoning",
      contentMarkdown: `Anthropic has officially introduced Claude 3.7 Sonnet, marking the industry's first frontier model natively unifying standard generation and extended thinking modes within a single architecture[^1].\n\nUnlike predecessor systems that segregated reasoning into distinct, high-latency model checkpoints, Claude 3.7 enables developers to dynamically calibrate thinking token budgets from zero up to 128,000 tokens[^2]. This granular steering allows applications to optimize for real-time responsiveness during conversational queries while reserving compute-intensive multi-step reasoning for difficult software engineering, mathematics, and formal verification problems.\n\nEvaluation benchmarks indicate substantial leaps across competitive programming and complex agentic workflows, setting a new paradigm for flexible inference-time scaling.`,
      metaDescription: "Anthropic launches Claude 3.7 Sonnet featuring dynamic hybrid reasoning and token-budget controls.",
      citations: [
        {
          citationIndex: 1,
          claimIndex: 0,
          anchorText: "first frontier model natively unifying standard generation and extended thinking",
          primarySourceUrl: "https://www.anthropic.com/news/claude-3-7-sonnet",
          sourcePublisher: "Anthropic Research",
        },
        {
          citationIndex: 2,
          claimIndex: 1,
          anchorText: "dynamically calibrate thinking token budgets from zero up to 128,000 tokens",
          primarySourceUrl: "https://www.anthropic.com/news/claude-3-7-sonnet",
          sourcePublisher: "Anthropic Research",
        },
      ],
    },
    plagiarismAudit: {
      maxSimilarity: 0.05,
      isAcceptable: true,
      longestCommonPhraseLength: 2,
      offendingPhrases: [],
    },
    readingTimeMinutes: 3,
  };

  const article1 = await manager.saveDraftArticle({
    synthesisResult: synthArticle1,
    storyClusterId: cluster1.id,
    verifiedClaims: [
      {
        id: claim1.id,
        claimText: claim1.claimText,
        claimType: claim1.claimType,
        confidenceScore: 0.99,
        primarySourceUrl: "https://www.anthropic.com/news/claude-3-7-sonnet",
        sourcePublisher: "Anthropic Research",
        verbatimExcerpt: "Claude 3.7 Sonnet is our first hybrid reasoning model...",
      },
      {
        id: claim2.id,
        claimText: claim2.claimText,
        claimType: claim2.claimType,
        confidenceScore: 0.98,
        primarySourceUrl: "https://www.anthropic.com/news/claude-3-7-sonnet",
        sourcePublisher: "Anthropic Research",
        verbatimExcerpt: "Developers have granular control over thinking budget...",
      },
    ],
  });

  // Approve Article 1 to make it live on the public feed
  await manager.approveArticle(article1.id, "editor_autonomous_seed");

  console.log("?? Seeding Story 2: DeepSeek-V3 Open Weights Release (Published)...");
  const [cluster2] = await db
    .insert(schema.storyClusters)
    .values({
      title: "DeepSeek Releases DeepSeek-V3 Open Architecture",
      slug: "deepseek-v3-open-architecture",
      summary: "DeepSeek open-sources a 671B parameter Mixture-of-Experts model.",
      status: "published",
    })
    .returning();

  const [claim3] = await db
    .insert(schema.claims)
    .values({
      storyClusterId: cluster2.id,
      claimText: "DeepSeek-V3 utilizes 671 billion total parameters with 37 billion active per token.",
      claimType: "architecture",
      verificationStatus: "verified_primary",
      confidenceScore: "0.99",
    })
    .returning();

  await db.insert(schema.evidences).values({
    claimId: claim3.id,
    sourceUrl: "https://github.com/deepseek-ai/DeepSeek-V3",
    sourceName: "DeepSeek AI Technical Report",
    sourceTier: "tier_1_primary",
    verbatimExcerpt: "DeepSeek-V3 adopts an innovative architecture with 671B total parameters, activating 37B per token via fine-grained expert routing.",
    entailment: "supports",
    rationale: "Confirmed in Section 2.1 of technical specification.",
  });

  const synthArticle2 = {
    draft: {
      title: "DeepSeek Open-Sources DeepSeek-V3 with 671B Mixture-of-Experts Architecture",
      deck: "Fine-grained routing activates 37B parameters per token, delivering competitive frontier performance at reduced training cost.",
      slug: "deepseek-open-sources-deepseek-v3-moe",
      contentMarkdown: `Artificial intelligence research lab DeepSeek has officially released the model weights and architecture specifications for DeepSeek-V3[^1].\n\nThe model implements an advanced Mixture-of-Experts (MoE) topology encompassing 671 billion total parameters, with exactly 37 billion activated for any individual token prediction. By utilizing multi-head latent attention (MLA) and FP8 mixed-precision training, the team demonstrated substantial compute efficiency gains during pre-training compared to dense transformer baselines.`,
      metaDescription: "DeepSeek-V3 open model released with 671B parameters and fine-grained expert routing.",
      citations: [
        {
          citationIndex: 1,
          claimIndex: 0,
          anchorText: "671 billion total parameters, with exactly 37 billion activated",
          primarySourceUrl: "https://github.com/deepseek-ai/DeepSeek-V3",
          sourcePublisher: "DeepSeek AI",
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

  const article2 = await manager.saveDraftArticle({
    synthesisResult: synthArticle2,
    storyClusterId: cluster2.id,
    verifiedClaims: [
      {
        id: claim3.id,
        claimText: claim3.claimText,
        claimType: claim3.claimType,
        confidenceScore: 0.99,
        primarySourceUrl: "https://github.com/deepseek-ai/DeepSeek-V3",
        sourcePublisher: "DeepSeek AI",
        verbatimExcerpt: "DeepSeek-V3 adopts an innovative architecture...",
      },
    ],
  });

  // Approve Article 2
  await manager.approveArticle(article2.id, "editor_autonomous_seed");

  console.log("?? Seeding Story 3: AlphaGeometry 2 (Pending in Newsroom Queue)...");
  const [cluster3] = await db
    .insert(schema.storyClusters)
    .values({
      title: "DeepMind AlphaGeometry 2 Olympiad Solver",
      slug: "deepmind-alphageometry-2-olympiad-solver",
      summary: "AlphaGeometry 2 demonstrates 83% success rate on International Mathematical Olympiad geometry problems.",
      status: "review_pending",
    })
    .returning();

  const [claim4] = await db
    .insert(schema.claims)
    .values({
      storyClusterId: cluster3.id,
      claimText: "AlphaGeometry 2 successfully resolves 83% of all IMO historical geometry problems.",
      claimType: "benchmark_result",
      verificationStatus: "verified_primary",
      confidenceScore: "0.99",
    })
    .returning();

  await db.insert(schema.evidences).values({
    claimId: claim4.id,
    sourceUrl: "https://deepmind.google/discover/blog/alphageometry-2",
    sourceName: "Google DeepMind",
    sourceTier: "tier_1_primary",
    verbatimExcerpt: "AlphaGeometry 2 solves 83% of all IMO geometry problems from 2000 to 2024, compared to 53% by the predecessor.",
    entailment: "supports",
    rationale: "Direct benchmark comparison published in DeepMind technical announcement.",
  });

  const synthArticle3 = {
    draft: {
      title: "Google DeepMind Demonstrates AlphaGeometry 2 with 83% Olympiad Geometry Benchmark",
      deck: "A neuro-symbolic reasoning engine demonstrates breakthrough automated geometric deduction capabilities.",
      slug: "deepmind-alphageometry-2-olympiad-geometry-breakthrough",
      contentMarkdown: `Google DeepMind has introduced AlphaGeometry 2, an advanced neuro-symbolic AI system capable of solving 83 percent of International Mathematical Olympiad (IMO) geometry problems across the past 25 years[^1].\n\nThe architecture couples a fine-tuned Gemini language model for intuitive hypothesis generation with a deterministic symbolic deduction engine, preventing mathematical hallucination.`,
      metaDescription: "AlphaGeometry 2 achieves 83% success rate on IMO Olympiad geometry challenges.",
      citations: [
        {
          citationIndex: 1,
          claimIndex: 0,
          anchorText: "solving 83 percent of International Mathematical Olympiad (IMO) geometry problems",
          primarySourceUrl: "https://deepmind.google/discover/blog/alphageometry-2",
          sourcePublisher: "Google DeepMind",
        },
      ],
    },
    plagiarismAudit: {
      maxSimilarity: 0.03,
      isAcceptable: true,
      longestCommonPhraseLength: 2,
      offendingPhrases: [],
    },
    readingTimeMinutes: 2,
  };

  // Leave Article 3 in 'review_pending' status for the Newsroom Queue!
  await manager.saveDraftArticle({
    synthesisResult: synthArticle3,
    storyClusterId: cluster3.id,
    verifiedClaims: [
      {
        id: claim4.id,
        claimText: claim4.claimText,
        claimType: claim4.claimType,
        confidenceScore: 0.99,
        primarySourceUrl: "https://deepmind.google/discover/blog/alphageometry-2",
        sourcePublisher: "Google DeepMind",
        verbatimExcerpt: "AlphaGeometry 2 solves 83% of all IMO geometry problems...",
      },
    ],
  });

  // 4. Log rich Observability Traces
  console.log("?? Seeding Agent Observability & Telemetry Traces...");
  const run1Id = await logger.startRun({
    agentName: "ClaimExtractionAgent",
    agentVersion: "1.0.0",
    modelProvider: "google_gemini",
    modelName: "gemini-2.5-flash",
    storyClusterId: cluster1.id,
  });
  await logger.logStep({
    agentRunId: run1Id,
    stepNumber: 1,
    actionName: "decompose_atomic_claims",
    inputPayload: { title: "Claude 3.7 Sonnet Announcement", textLength: 1840 },
    outputPayload: { extractedClaims: 2 },
    rationale: "Extracted 2 atomic assertions with source quotes.",
  });
  await logger.finishRun(run1Id, {
    status: "success",
    promptTokens: 1420,
    completionTokens: 215,
    latencyMs: 810,
  });

  const run2Id = await logger.startRun({
    agentName: "FactVerificationAgent",
    agentVersion: "1.0.0",
    modelProvider: "google_gemini",
    modelName: "gemini-2.5-flash",
    storyClusterId: cluster1.id,
  });
  await logger.logStep({
    agentRunId: run2Id,
    stepNumber: 1,
    actionName: "natural_language_inference",
    inputPayload: { claim: "hybrid reasoning architecture", sourceTier: "tier_1_primary" },
    outputPayload: { entailment: "supports", confidence: 0.99 },
    rationale: "Verified against Anthropic primary press release.",
  });
  await logger.finishRun(run2Id, {
    status: "success",
    promptTokens: 840,
    completionTokens: 145,
    latencyMs: 620,
  });

  const run3Id = await logger.startRun({
    agentName: "EditorialSynthesisAgent",
    agentVersion: "1.0.0",
    modelProvider: "google_gemini",
    modelName: "gemini-2.5-pro",
    storyClusterId: cluster1.id,
  });
  await logger.logStep({
    agentRunId: run3Id,
    stepNumber: 1,
    actionName: "evidence_bounded_synthesis",
    inputPayload: { verifiedClaimsCount: 2, maxAllowedSimilarity: 0.12 },
    outputPayload: { generatedWords: 195, nGramSimilarity: 0.05, citationsCount: 2 },
    rationale: "Plagiarism check passed (5% < 12%). All claims grounded in primary citations.",
  });
  await logger.finishRun(run3Id, {
    status: "success",
    promptTokens: 2100,
    completionTokens: 420,
    latencyMs: 1650,
  });

  console.log("? [NAKSHATRA] Seed complete! Platform is ready for inspection.");
}

main().catch(console.error);
