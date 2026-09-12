import dotenv from 'dotenv';
import { performance } from 'node:perf_hooks';

dotenv.config({ path: '.env.local' });
dotenv.config();

// This script never initializes schemas, invokes workers, or calls AI services.
// All database operations are pinned to one read-only transaction.
const watchdog = setTimeout(() => process.exit(1), 45000);
const { getDb, getActivePool, closeDb } = await import('../src/db');
const { ArticleManager } = await import('../src/services/editorial/article-manager');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for this audit.');
await getDb();
const pool = getActivePool();
if (!pool) throw new Error('Audit requires PostgreSQL; PGlite is prohibited.');
const connectionStart = performance.now();
const client = await pool.connect();
const connectionMs = performance.now() - connectionStart;
try {
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout = '5s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
  const queryLog: Array<{ stage: string; ms: number }> = [];
  let stage = 'audit';
  // Pin ArticleManager to the same read-only connection, including its concurrent reads.
  const runQuery = async (...args: unknown[]) => {
    const start = performance.now();
    const result = await Reflect.apply(client.query, client, args);
    queryLog.push({ stage, ms: performance.now() - start });
    return result;
  };
  pool.query = runQuery as typeof pool.query;
  const counts = await client.query(`SELECT
    (SELECT count(*)::int FROM raw_articles) AS raw_articles,
    count(*)::int AS stories,
    count(*) FILTER (WHERE editorial_status='auto_approved' AND processing_status='pending')::int AS auto_approved_pending,
    count(*) FILTER (WHERE processing_status='processing')::int AS processing,
    count(*) FILTER (WHERE processing_status='failed')::int AS failed,
    count(*) FILTER (WHERE processing_status='completed')::int AS completed,
    count(*) FILTER (WHERE editorial_status='published')::int AS published_stories,
    (SELECT count(*)::int FROM articles) AS articles,
    (SELECT count(*)::int FROM articles WHERE status='published') AS published_articles,
    max(last_attempted_at) AS latest_attempt FROM stories`);
  const latest = await client.query('SELECT id, slug, status, published_at AS "publishedAt", story_id AS "storyId" FROM articles WHERE status=\'published\' ORDER BY published_at DESC, id DESC LIMIT 20');
  const duplicates = await client.query('SELECT story_id, count(*)::int FROM articles WHERE story_id IS NOT NULL GROUP BY story_id HAVING count(*) > 1 LIMIT 20');
  const runs = await client.query("SELECT agent_name, status, created_at, latency_ms, left(error_message, 300) AS error FROM agent_runs WHERE agent_name IN ('pipeline_cron', 'EditorialSynthesisAgent', 'HybridStoryClusteringAgent') ORDER BY created_at DESC LIMIT 20");
  const locks = await client.query('SELECT lock_name, locked_at, expires_at FROM system_locks LIMIT 10');
  const workerActivity = await client.query("SELECT agent_name, model_provider, model_name, status, count(*)::int AS runs, max(created_at) AS latest FROM agent_runs GROUP BY agent_name, model_provider, model_name, status ORDER BY max(created_at) DESC LIMIT 20");
  const pipelineRuns = await client.query("SELECT status, created_at, latency_ms FROM agent_runs WHERE agent_name = 'pipeline_cron' ORDER BY created_at DESC LIMIT 10");
  const manager = new ArticleManager();
  stage = 'manager';
  const managerStart = performance.now();
  const articles = await manager.getPublishedArticlesWithMetadata(12, 0);
  const managerMs = performance.now() - managerStart;
  stage = 'count';
  const count = await manager.countPublishedArticles();
  const serializationStart = performance.now();
  const serialized = JSON.stringify(articles);
  const serializationMs = performance.now() - serializationStart;
  stage = 'api';
  const { GET } = await import('../src/app/api/articles/route');
  const apiStart = performance.now();
  const response = await GET(new Request('http://localhost/api/articles'));
  const apiBody = await response.json();
  const apiMs = performance.now() - apiStart;
  if (response.status !== 200) throw new Error(`Public handler returned HTTP ${response.status}`);
  const target = new URL(process.env.DATABASE_URL);
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), target: { host: target.hostname, database: target.pathname.slice(1) }, connectionMs, counts: counts.rows[0], latestPublished: latest.rows, duplicates: duplicates.rows, latestRuns: runs.rows, workerActivity: workerActivity.rows, pipelineRuns: pipelineRuns.rows, locks: locks.rows, manager: { total: count, returned: articles.length, slugs: articles.map(a => a.slug), ms: managerMs, queries: queryLog.filter(q => q.stage === 'manager'), serializationMs, serializedBytes: Buffer.byteLength(serialized) }, api: { status: response.status, ms: apiMs, returned: apiBody.articles.length, total: apiBody.pagination.total, queries: queryLog.filter(q => q.stage === 'api') } }, null, 2));
} finally {
  await client.query('ROLLBACK');
  client.release();
  await closeDb();
  clearTimeout(watchdog);
}
