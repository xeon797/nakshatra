import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { getDb, closeDb, schema } from '../src/db';
import { eq, sql } from 'drizzle-orm';
import { GeminiProvider } from '../src/services/ai/gemini-provider';
import { MultiSourceResearcherAgent } from '../src/server/agents/researcher';
import { MultiSourceWriterAgent } from '../src/server/agents/writer';
import { ArticleManager } from '../src/services/editorial/article-manager';

const EXECUTION_TIMEOUT_MS = 120000;

export async function runControlledStoryExecution() {
  const executionStart = Date.now();
  console.log('========================================================================');
  console.log('🚀 CONTROLLED PRODUCTION PIPELINE EXECUTION (EXACTLY 1 STORY)');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Constraint: Max 1 Story | Max Gemini Budget = 1 | Strict Timeouts`);
  console.log('========================================================================\n');

  const watchdog = setTimeout(() => {
    console.error('\n🚨 [WATCHDOG] Controlled execution timed out after 60s. Force exiting.');
    process.exit(1);
  }, EXECUTION_TIMEOUT_MS);
  watchdog.unref();

  try {
    const db = await getDb();

    // ─────────────────────────────────────────────────────────────────────────
    // Step 1: Query initial baseline article count
    // ─────────────────────────────────────────────────────────────────────────
    const [initialPubRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.articles)
      .where(eq(schema.articles.status, 'published'));
    const initialPublishedCount = initialPubRow.count;
    console.log(`[${new Date().toISOString()}] Step 1: Initial Published Articles in Neon: ${initialPublishedCount}`);

    // ─────────────────────────────────────────────────────────────────────────
    // Step 2: Select EXACTLY ONE eligible production story
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`[${new Date().toISOString()}] Step 2: Selecting eligible auto-approved story...`);
    const eligibleStories = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.editorialStatus, 'auto_approved'))
      .limit(10);

    // Pick one that has linked raw sources
    let targetStory: typeof schema.stories.$inferSelect | null = null;
    let linkedSourcesCount = 0;

    for (const story of eligibleStories) {
      const sources = await db
        .select()
        .from(schema.storySources)
        .where(eq(schema.storySources.storyId, story.id));

      if (sources.length > 0) {
        targetStory = story;
        linkedSourcesCount = sources.length;
        break;
      }
    }

    if (!targetStory) {
      throw new Error('No eligible auto-approved stories with linked sources found in database.');
    }

    console.log(`[${new Date().toISOString()}] Selected Story:`);
    console.log(`  - ID:              ${targetStory.id}`);
    console.log(`  - Title:           "${targetStory.title}"`);
    console.log(`  - Category:        ${targetStory.category}`);
    console.log(`  - Editorial Status: ${targetStory.editorialStatus}`);
    console.log(`  - Processing Status:${targetStory.processingStatus}`);
    console.log(`  - Importance Score: ${targetStory.importanceScore}`);
    console.log(`  - Linked Sources:   ${linkedSourcesCount}\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Step 3: Configure Gemini provider with strict budget = 1 and 25s timeout
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`[${new Date().toISOString()}] Step 3: Initializing GeminiProvider...`);
    const apiKey = (process.env.GEMINI_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    const provider = new GeminiProvider(apiKey, 'gemini-3.5-flash', 65000);
    provider.setRequestBudget(1); // Enforce EXACTLY 1 Gemini request budget

    console.log(`  - Configured Model:  ${provider.defaultModel}`);
    console.log(`  - Request Budget:    ${provider.getRequestBudget()}`);
    console.log(`  - Initial Requests:  ${provider.getRequestsExecuted()}\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Step 4: Build deterministic evidence packet (0 Gemini calls consumed)
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`[${new Date().toISOString()}] Step 4: Building evidence packet via Researcher...`);
    const researchStart = Date.now();
    const researcher = new MultiSourceResearcherAgent(provider);
    const evidencePacket = await researcher.buildEvidencePacket(targetStory.id, {
      deterministicOnly: true,
    });
    const researchLatency = Date.now() - researchStart;

    console.log(`  - Research latency:   ${researchLatency}ms`);
    console.log(`  - Primary sources:    ${evidencePacket.primarySources.length}`);
    console.log(`  - Secondary sources:  ${evidencePacket.secondarySources.length}`);
    console.log(`  - Confirmed facts:    ${evidencePacket.confirmedFacts.length}`);
    console.log(`  - Gemini calls used:  ${provider.getRequestsExecuted()} / ${provider.getRequestBudget()}\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Step 5: Synthesize bilingual article (Consumes the 1 Gemini request)
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`[${new Date().toISOString()}] Step 5: Synthesizing article via Writer Agent...`);
    const synthStart = Date.now();
    const writer = new MultiSourceWriterAgent(provider);
    const publishedArticle = await writer.synthesizeStoryArticle(evidencePacket, {
      publicationIntent: 'published',
    });
    const synthLatency = Date.now() - synthStart;

    console.log(`  - Synthesis latency:  ${synthLatency}ms`);
    console.log(`  - Article ID:         ${publishedArticle.id}`);
    console.log(`  - Article Slug:       ${publishedArticle.slug}`);
    console.log(`  - Article Status:     ${publishedArticle.status}`);
    console.log(`  - Published At:       ${publishedArticle.publishedAt ? new Date(publishedArticle.publishedAt).toISOString() : 'NULL'}`);
    console.log(`  - English Title:      "${publishedArticle.titleEn || publishedArticle.title}"`);
    console.log(`  - Bengali Title:      "${publishedArticle.titleBn || 'none'}"`);
    console.log(`  - Gemini calls used:  ${provider.getRequestsExecuted()} / ${provider.getRequestBudget()}\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Step 6: Strict Invariant Assertions & State Verification
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`[${new Date().toISOString()}] Step 6: Verifying invariants in Neon database...`);

    // Assertion 1: Article status is 'published'
    if (publishedArticle.status !== 'published') {
      throw new Error(`Assertion Failed: Article status is '${publishedArticle.status}', expected 'published'`);
    }

    // Assertion 2: Slug format is strict Latin kebab-case
    const latinSlugRegex = /^[a-z0-9-]+$/;
    if (!latinSlugRegex.test(publishedArticle.slug)) {
      throw new Error(`Assertion Failed: Slug "${publishedArticle.slug}" does not match Latin regex /^[a-z0-9-]+$/`);
    }

    // Assertion 3: Story state in database is updated to 'published' and 'completed'
    const [updatedStory] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, targetStory.id));

    console.log(`  - Updated Story editorialStatus:  ${updatedStory.editorialStatus}`);
    console.log(`  - Updated Story processingStatus: ${updatedStory.processingStatus}`);

    if (updatedStory.editorialStatus !== 'published') {
      throw new Error(`Assertion Failed: Story editorialStatus is '${updatedStory.editorialStatus}', expected 'published'`);
    }
    if (updatedStory.processingStatus !== 'completed') {
      throw new Error(`Assertion Failed: Story processingStatus is '${updatedStory.processingStatus}', expected 'completed'`);
    }

    // Assertion 4: Citations exist in Neon
    const citations = await db
      .select()
      .from(schema.articleCitations)
      .where(eq(schema.articleCitations.articleId, publishedArticle.id));
    console.log(`  - Article Citations in DB:        ${citations.length}`);
    if (citations.length === 0) {
      throw new Error('Assertion Failed: 0 citations persisted for synthesized article.');
    }

    // Assertion 5: Published count increased by exactly 1
    const [finalPubRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.articles)
      .where(eq(schema.articles.status, 'published'));
    const finalPublishedCount = finalPubRow.count;
    console.log(`  - Final Published Count in Neon:  ${finalPublishedCount} (Baseline was: ${initialPublishedCount})`);
    if (finalPublishedCount !== initialPublishedCount + 1) {
      throw new Error(`Assertion Failed: Expected count to increase by 1, got ${finalPublishedCount} vs ${initialPublishedCount}`);
    }

    // Assertion 6: Public Query Visibility
    const articleManager = new ArticleManager();
    const publicArticles = await articleManager.getPublishedArticlesWithMetadata(10, 0);
    const foundInPublic = publicArticles.some((a) => a.id === publishedArticle.id);
    console.log(`  - Found in Public Feed Query:     ${foundInPublic ? 'YES (Visible to Readers)' : 'NO'}`);
    if (!foundInPublic) {
      throw new Error('Assertion Failed: Newly published article is not returned by public reader query.');
    }

    // Assertion 7: Budget constraint respected
    if (provider.getRequestsExecuted() > 1) {
      throw new Error(`Assertion Failed: Executed ${provider.getRequestsExecuted()} requests, budget was 1.`);
    }

    const totalDurationMs = Date.now() - executionStart;
    console.log('\n========================================================================');
    console.log(`🎉 CONTROLLED CONVERSION PROVEN: STORY TO PUBLIC ARTICLE IN ${totalDurationMs}ms`);
    console.log('========================================================================\n');

    return {
      success: true,
      storyId: targetStory.id,
      storyTitle: targetStory.title,
      articleId: publishedArticle.id,
      articleSlug: publishedArticle.slug,
      articleTitleEn: publishedArticle.titleEn || publishedArticle.title,
      articleTitleBn: publishedArticle.titleBn,
      initialPublishedCount,
      finalPublishedCount,
      geminiCalls: provider.getRequestsExecuted(),
      durationMs: totalDurationMs,
    };
  } finally {
    console.log(`[${new Date().toISOString()}] Closing database connection pool...`);
    await closeDb();
    console.log(`[${new Date().toISOString()}] Teardown complete.`);
  }
}

const isDirectExecution = process.argv[1]?.includes('controlled-pipeline-execution');
if (isDirectExecution) {
  runControlledStoryExecution()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n❌ [CONTROLLED EXECUTION FAILED]:', err);
      process.exit(1);
    });
}
