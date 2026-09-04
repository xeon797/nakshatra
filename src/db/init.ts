import { getDb } from './index';
import { sql } from 'drizzle-orm';
import { seedDefaultSources } from '../services/ingestion/seed-sources';

export const INIT_DDL = `
CREATE TABLE IF NOT EXISTS sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    base_url VARCHAR(500) NOT NULL UNIQUE,
    source_type VARCHAR(50) NOT NULL DEFAULT 'rss',
    tier VARCHAR(50) NOT NULL DEFAULT 'tier_2_verified',
    reputation_score NUMERIC(3, 2) NOT NULL DEFAULT 0.80,
    is_active BOOLEAN NOT NULL DEFAULT true,
    polling_frequency_minutes INT NOT NULL DEFAULT 15,
    last_polled_at TIMESTAMPTZ,
    scrape_rules_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    external_id VARCHAR(500),
    canonical_url VARCHAR(1000) NOT NULL UNIQUE,
    title TEXT NOT NULL,
    authors TEXT[] DEFAULT ARRAY[]::TEXT[],
    raw_content TEXT NOT NULL,
    clean_text TEXT NOT NULL,
    summary_excerpt TEXT,
    published_at TIMESTAMPTZ,
    content_hash VARCHAR(64) NOT NULL,
    simhash_fingerprint VARCHAR(64),
    processing_status VARCHAR(50) NOT NULL DEFAULT 'ingested',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS story_clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(500) NOT NULL,
    slug VARCHAR(500) NOT NULL UNIQUE,
    summary TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    velocity_score NUMERIC(5, 2) NOT NULL DEFAULT 1.00,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS story_cluster_sources (
    story_cluster_id UUID NOT NULL REFERENCES story_clusters(id) ON DELETE CASCADE,
    raw_article_id UUID NOT NULL REFERENCES raw_articles(id) ON DELETE CASCADE,
    is_primary_source BOOLEAN NOT NULL DEFAULT false,
    relevance_score NUMERIC(3, 2) NOT NULL DEFAULT 1.00,
    PRIMARY KEY (story_cluster_id, raw_article_id)
);

CREATE TABLE IF NOT EXISTS claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_cluster_id UUID NOT NULL REFERENCES story_clusters(id) ON DELETE CASCADE,
    claim_text TEXT NOT NULL,
    claim_type VARCHAR(100) NOT NULL,
    extracted_from_raw_id UUID REFERENCES raw_articles(id) ON DELETE SET NULL,
    verification_status VARCHAR(50) NOT NULL DEFAULT 'unverified',
    confidence_score NUMERIC(3, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evidences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    source_url VARCHAR(1000) NOT NULL,
    source_name VARCHAR(255) NOT NULL,
    source_tier VARCHAR(50) NOT NULL DEFAULT 'tier_2_verified',
    verbatim_excerpt TEXT NOT NULL,
    entailment VARCHAR(50) NOT NULL,
    rationale TEXT NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_cluster_id UUID REFERENCES story_clusters(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    deck TEXT NOT NULL,
    content_markdown TEXT NOT NULL,
    meta_description VARCHAR(320) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    confidence_score NUMERIC(3, 2) NOT NULL DEFAULT 0.00,
    n_gram_max_similarity NUMERIC(3, 2) NOT NULL DEFAULT 0.00,
    reading_time_minutes INT NOT NULL DEFAULT 3,
    hero_image_url VARCHAR(1000),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS article_citations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    claim_id UUID REFERENCES claims(id) ON DELETE SET NULL,
    citation_index INT NOT NULL,
    anchor_text VARCHAR(255) NOT NULL,
    primary_source_url VARCHAR(1000) NOT NULL,
    source_publisher VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS article_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    editor_user_id VARCHAR(255) NOT NULL,
    diff_summary TEXT NOT NULL,
    previous_content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
    story_cluster_id UUID REFERENCES story_clusters(id) ON DELETE SET NULL,
    agent_name VARCHAR(100) NOT NULL,
    agent_version VARCHAR(50) NOT NULL,
    model_provider VARCHAR(50) NOT NULL,
    model_name VARCHAR(100) NOT NULL,
    prompt_tokens INT NOT NULL DEFAULT 0,
    completion_tokens INT NOT NULL DEFAULT 0,
    total_cost_usd NUMERIC(8, 6) NOT NULL DEFAULT 0.000000,
    latency_ms INT NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_step_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    step_number INT NOT NULL,
    action_name VARCHAR(100) NOT NULL,
    input_payload JSONB NOT NULL,
    output_payload JSONB NOT NULL,
    rationale TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscribers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(320) NOT NULL UNIQUE,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    verification_token VARCHAR(255),
    unsubscribed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE IF NOT EXISTS topic_subscriptions (
    subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    cadence VARCHAR(50) NOT NULL DEFAULT 'daily',
    PRIMARY KEY (subscriber_id, topic_id)
);
`;

let initPromise: Promise<void> | null = null;

export async function initializeDatabase(): Promise<void> {
  const db = await getDb();
  const statements = INIT_DDL.split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}

export async function ensureDatabaseInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await initializeDatabase();
      await seedDefaultSources();
    })();
  }
  return initPromise;
}

export function resetInitForTesting(): void {
  initPromise = null;
}
