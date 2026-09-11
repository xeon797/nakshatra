import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { getDb, closeDb, schema } from '../src/db';
import { validateProductionEnv } from '../src/lib/env';
import { eq, sql } from 'drizzle-orm';
import { handlePipelineCron } from '../src/server/cron/pipeline-cron';
import { PIPELINE_GLOBAL_LOCK } from '../src/server/lib/pipeline-lock';
import { ArticleManager } from '../src/services/editorial/article-manager';

interface PhaseResult {
  phase: string;
  name: string;
  status: 'PASS' | 'FAIL';
  startTime: string;
  endTime: string;
  durationMs: number;
  details: string;
  error?: string;
}

const PHASE_TIMEOUT_MS = 5000;

async function executePhaseWithTimeout(
  phaseCode: string,
  phaseName: string,
  fn: () => Promise<string>
): Promise<PhaseResult> {
  const startTime = new Date().toISOString();
  const startMs = Date.now();
  console.log(`\n------------------------------------------------------------`);
  console.log(`[${startTime}] >>> START Phase ${phaseCode}: ${phaseName}`);

  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[BLOCKING TIMEOUT] Phase ${phaseCode} (${phaseName}) exceeded ${PHASE_TIMEOUT_MS}ms threshold.`));
    }, PHASE_TIMEOUT_MS);
  });

  try {
    const details = await Promise.race([fn(), timeoutPromise]);
    const endMs = Date.now();
    const endTime = new Date().toISOString();
    const durationMs = endMs - startMs;
    console.log(`[${endTime}] <<< END Phase ${phaseCode}: PASS (${durationMs}ms)`);
    console.log(`    Details: ${details}`);
    return {
      phase: phaseCode,
      name: phaseName,
      status: 'PASS',
      startTime,
      endTime,
      durationMs,
      details,
    };
  } catch (err) {
    const endMs = Date.now();
    const endTime = new Date().toISOString();
    const durationMs = endMs - startMs;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${endTime}] <<< END Phase ${phaseCode}: FAIL (${durationMs}ms)`);
    console.error(`    BLOCKING ERROR: ${errorMsg}`);
    return {
      phase: phaseCode,
      name: phaseName,
      status: 'FAIL',
      startTime,
      endTime,
      durationMs,
      details: 'Execution failed or timed out',
      error: errorMsg,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runProductionDiagnostics(): Promise<boolean> {
  console.log('============================================================');
  console.log('🔍 NAKSHATRA PRODUCTION INCREMENTAL DIAGNOSTIC');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Hard timeout per phase: ${PHASE_TIMEOUT_MS}ms`);
  console.log('============================================================');

  // Hard process watchdog to guarantee termination even if unhandled handle remains
  const watchdog = setTimeout(() => {
    console.error(`\n🚨 [GLOBAL WATCHDOG] Process hard timeout (35s) reached. Terminating forcefully.`);
    process.exit(1);
  }, 35000);
  watchdog.unref();

  const results: PhaseResult[] = [];

  try {
    // ------------------------------------------------------------
    // Phase A: Environment variable validation
    // ------------------------------------------------------------
    const resA = await executePhaseWithTimeout('A', 'Environment Variable Validation', async () => {
      const prodCheck = validateProductionEnv(process.env);
      if (!prodCheck.valid) {
        throw new Error(`Missing required production environment variables: [${prodCheck.missing.join(', ')}]`);
      }

      const dbUrl = process.env.DATABASE_URL || '';
      const isNeon = dbUrl.includes('neon.tech');
      const hasGemini = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 5);
      const hasCronSecret = Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.length > 5);
      const hasAdminSecret = Boolean(process.env.ADMIN_API_SECRET && process.env.ADMIN_API_SECRET.length > 5);
      const hasResend = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.startsWith('re_'));
      const hasTavily = Boolean(process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY.startsWith('tvly-'));
      const hasJina = Boolean(process.env.JINA_API_KEY && process.env.JINA_API_KEY.startsWith('jina_'));

      return `Production env valid. Database target: ${isNeon ? 'Neon Cloud Postgres' : 'Postgres'}. Gemini: ${hasGemini ? 'Configured' : 'Missing'}, Cron: ${hasCronSecret ? 'Configured' : 'Missing'}, Admin: ${hasAdminSecret ? 'Configured' : 'Missing'}, Integrations: [Resend: ${hasResend}, Tavily: ${hasTavily}, Jina: ${hasJina}]`;
    });
    results.push(resA);
    if (resA.status === 'FAIL') return false;

    // ------------------------------------------------------------
    // Phase B: Neon Connectivity
    // ------------------------------------------------------------
    const resB = await executePhaseWithTimeout('B', 'Neon Connectivity', async () => {
      const db = await getDb();
      const probeStart = Date.now();
      const probeResult = await db.execute<{
        probe: number;
        server_time: string;
        db_name: string;
        version: string;
      }>(sql`SELECT 1 AS probe, NOW() AS server_time, current_database() AS db_name, version() AS version;`);
      const probeLatencyMs = Date.now() - probeStart;

      const row = probeResult.rows?.[0] as unknown as {
        probe: number;
        server_time: string;
        db_name: string;
        version: string;
      } | undefined;

      if (!row || Number(row.probe) !== 1) {
        throw new Error('Database probe query did not return expected result.');
      }

      const shortVersion = (row.version || '').split(' ')[0] + ' ' + (row.version || '').split(' ')[1];
      return `Connected successfully to database "${row.db_name}" (${shortVersion}) with round-trip latency ${probeLatencyMs}ms. Server time: ${row.server_time}`;
    });
    results.push(resB);
    if (resB.status === 'FAIL') return false;

    // ------------------------------------------------------------
    // Phase C: Published Article Count
    // ------------------------------------------------------------
    const resC = await executePhaseWithTimeout('C', 'Published Article Count', async () => {
      const db = await getDb();

      const [publishedRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.articles)
        .where(eq(schema.articles.status, 'published'));

      const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.articles);

      const [reviewPendingRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.articles)
        .where(eq(schema.articles.status, 'review_pending'));

      const pubCount = publishedRow?.count ?? 0;
      const totalCount = totalRow?.count ?? 0;
      const reviewPendingCount = reviewPendingRow?.count ?? 0;

      return `Published articles: ${pubCount} (Total articles in DB: ${totalCount}, Review pending: ${reviewPendingCount})`;
    });
    results.push(resC);
    if (resC.status === 'FAIL') return false;

    // ------------------------------------------------------------
    // Phase D: Source Count
    // ------------------------------------------------------------
    const resD = await executePhaseWithTimeout('D', 'Source Count', async () => {
      const db = await getDb();

      const [activeRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.sources)
        .where(eq(schema.sources.isActive, true));

      const [totalSourcesRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.sources);

      const [tier1Row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.sources)
        .where(eq(schema.sources.tier, 'tier_1_official'));

      const activeCount = activeRow?.count ?? 0;
      const totalCount = totalSourcesRow?.count ?? 0;
      const tier1Count = tier1Row?.count ?? 0;

      return `Active sources: ${activeCount} (Total configured sources: ${totalCount}, Tier 1 official sources: ${tier1Count})`;
    });
    results.push(resD);
    if (resD.status === 'FAIL') return false;

    // ------------------------------------------------------------
    // Phase E: Pipeline Endpoint Health
    // ------------------------------------------------------------
    const resE = await executePhaseWithTimeout('E', 'Pipeline Endpoint Health', async () => {
      const db = await getDb();

      // 1. Verify pipeline route authentication gate responds rapidly without executing worker
      const unauthReq = new Request('http://localhost:3000/api/cron/pipeline', { method: 'GET' });
      const authGateStart = Date.now();
      const authGateRes = await handlePipelineCron(unauthReq);
      const authGateLatency = Date.now() - authGateStart;

      if (authGateRes.status !== 401) {
        throw new Error(`Pipeline endpoint expected 401 Unauthorized for unauthenticated request, received ${authGateRes.status}`);
      }

      // 2. Check DB pipeline concurrency lock status
      const [currentLock] = await db
        .select()
        .from(schema.systemLocks)
        .where(eq(schema.systemLocks.lockName, PIPELINE_GLOBAL_LOCK))
        .limit(1);

      let lockState = 'Unlocked / Idle (ready for autonomous or manual run)';
      if (currentLock) {
        const isExpired = new Date(currentLock.expiresAt).getTime() < Date.now();
        lockState = isExpired
          ? `Stale lock (expired at ${new Date(currentLock.expiresAt).toISOString()}, owner: ${currentLock.ownerId})`
          : `Active lock held by ${currentLock.ownerId} until ${new Date(currentLock.expiresAt).toISOString()}`;
      }

      return `Route handler responsive (${authGateLatency}ms, 401 guard verified). Lock status: ${lockState}. Pipeline worker wiring intact.`;
    });
    results.push(resE);
    if (resE.status === 'FAIL') return false;

    // ------------------------------------------------------------
    // Phase F: Public Query Verification
    // ------------------------------------------------------------
    const resF = await executePhaseWithTimeout('F', 'Public Query Verification', async () => {
      const articleManager = new ArticleManager();

      // Test multi-table join used by public home feed & reader
      const queryStart = Date.now();
      const publishedArticles = await articleManager.getPublishedArticlesWithMetadata(10, 0);
      const queryLatency = Date.now() - queryStart;

      if (publishedArticles.length === 0) {
        return `Public query executed successfully in ${queryLatency}ms. No published articles currently available to display.`;
      }

      // Verify invariant fields on sample published articles
      for (const a of publishedArticles) {
        if (!a.id || !a.slug || !a.title) {
          throw new Error(`Published article [${a.id}] missing core invariants: slug="${a.slug}", title="${a.title}"`);
        }
      }

      const sample = publishedArticles[0];
      const hasBilingual = Boolean(sample.titleBn || sample.summaryBn || sample.contentBn);

      return `Public query executed in ${queryLatency}ms. Returned ${publishedArticles.length} published articles with metadata. Sample: "${sample.title.slice(0, 50)}..." (slug: ${sample.slug}, bilingual: ${hasBilingual ? 'yes' : 'no'})`;
    });
    results.push(resF);
    if (resF.status === 'FAIL') return false;

    return true;
  } finally {
    // Guaranteed cleanup of DB pool so Node process can exit cleanly
    console.log('\n------------------------------------------------------------');
    console.log(`[${new Date().toISOString()}] 🧹 Performing teardown: Closing database connections...`);
    try {
      await closeDb();
      console.log(`[${new Date().toISOString()}] ✓ Database connections cleanly closed.`);
    } catch (cleanupErr) {
      console.warn(`[${new Date().toISOString()}] ⚠️ Notice during DB close:`, cleanupErr);
    }
  }
}

// Direct execution
const isDirectExecution = process.argv[1]?.includes('production-diagnostic');
if (isDirectExecution) {
  runProductionDiagnostics()
    .then((allPassed) => {
      console.log('\n============================================================');
      if (allPassed) {
        console.log('🎉 ALL 6 PRODUCTION DIAGNOSTIC PHASES PASSED (100%)');
        console.log('============================================================');
        process.exit(0);
      } else {
        console.error('❌ PRODUCTION DIAGNOSTICS FAILED AT BLOCKING PHASE');
        console.log('============================================================');
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Fatal unhandled error during diagnostic run:', err);
      process.exit(1);
    });
}
