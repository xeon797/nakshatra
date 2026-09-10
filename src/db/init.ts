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
    image_url TEXT,
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
    title_en VARCHAR(255) NOT NULL DEFAULT '',
    title_bn VARCHAR(255) NOT NULL DEFAULT '',
    summary_en TEXT NOT NULL DEFAULT '',
    summary_bn TEXT NOT NULL DEFAULT '',
    content_en TEXT NOT NULL DEFAULT '',
    content_bn TEXT NOT NULL DEFAULT '',
    key_takeaways_en TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    key_takeaways_bn TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    meta_description VARCHAR(320) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    confidence_score NUMERIC(3, 2) NOT NULL DEFAULT 0.00,
    n_gram_max_similarity NUMERIC(3, 2) NOT NULL DEFAULT 0.00,
    reading_time_minutes INT NOT NULL DEFAULT 3,
    hero_image_url VARCHAR(1000),
    image_url TEXT,
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
    email VARCHAR(255) NOT NULL UNIQUE,
    topics TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    preferred_language VARCHAR(10) NOT NULL DEFAULT 'bn',
    is_active BOOLEAN NOT NULL DEFAULT true,
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

CREATE TABLE IF NOT EXISTS stories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    category VARCHAR(64) NOT NULL,
    editorial_status editorial_status NOT NULL DEFAULT 'needs_review',
    risk_level risk_level NOT NULL,
    importance_score INT NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_updated_at TIMESTAMPTZ NOT NULL,
    primary_source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
    processing_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    retry_count INT NOT NULL DEFAULT 0,
    failure_reason TEXT,
    failure_stage VARCHAR(50),
    last_attempted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS story_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    raw_article_id UUID NOT NULL REFERENCES raw_articles(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT uq_story_sources_story_raw UNIQUE (story_id, raw_article_id)
);

CREATE INDEX IF NOT EXISTS idx_story_sources_story_id ON story_sources(story_id);
CREATE INDEX IF NOT EXISTS idx_story_sources_raw_article_id ON story_sources(raw_article_id);
CREATE INDEX IF NOT EXISTS idx_stories_editorial_status ON stories(editorial_status);
CREATE INDEX IF NOT EXISTS idx_stories_category ON stories(category);
CREATE INDEX IF NOT EXISTS idx_stories_first_seen_at ON stories(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_stories_processing_status ON stories(processing_status);

ALTER TABLE stories ADD COLUMN IF NOT EXISTS processing_status VARCHAR(50) NOT NULL DEFAULT 'pending';
ALTER TABLE stories ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS failure_stage VARCHAR(50);
ALTER TABLE stories ADD COLUMN IF NOT EXISTS last_attempted_at TIMESTAMPTZ;

ALTER TABLE articles ADD COLUMN IF NOT EXISTS story_id UUID REFERENCES stories(id) ON DELETE SET NULL;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS title_en VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS title_bn VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS summary_en TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS summary_bn TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS content_en TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS content_bn TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS key_takeaways_en TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE articles ADD COLUMN IF NOT EXISTS key_takeaways_bn TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS topics TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(10) NOT NULL DEFAULT 'bn';
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS system_locks (
    lock_name VARCHAR(100) PRIMARY KEY,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    owner_id VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS newsletter_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_en VARCHAR(500) NOT NULL,
    subject_bn VARCHAR(500) NOT NULL,
    sent_count INT NOT NULL DEFAULT 0,
    skipped_count INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    recipients_count INT NOT NULL DEFAULT 0,
    error_log TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export const ENUM_DDL = [
  `DO $$ BEGIN CREATE TYPE editorial_status AS ENUM ('auto_approved', 'needs_review', 'rejected', 'published'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
];

let initPromise: Promise<void> | null = null;

export async function isDatabaseInitialized(): Promise<boolean> {
  try {
    const db = await getDb();
    const result = (await db.execute(
      sql`SELECT 1 FROM information_schema.tables WHERE table_name = 'sources' LIMIT 1;`
    )) as { rows?: unknown[] } | unknown[];
    const rows = Array.isArray(result) ? result : result?.rows;
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

export async function initializeDatabase(): Promise<void> {
  const db = await getDb();
  for (const enumStmt of ENUM_DDL) {
    try {
      await db.execute(sql.raw(enumStmt));
    } catch {
      // Ignored if type already exists
    }
  }

  const statements = INIT_DDL.split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }

  try {
    await db.execute(sql.raw('ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS image_url text;'));
    await db.execute(sql.raw('ALTER TABLE articles ADD COLUMN IF NOT EXISTS image_url text;'));
    await db.execute(sql.raw('ALTER TABLE stories ADD COLUMN IF NOT EXISTS processing_status VARCHAR(50) NOT NULL DEFAULT \'pending\';'));
    await db.execute(sql.raw('ALTER TABLE stories ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;'));
    await db.execute(sql.raw('ALTER TABLE stories ADD COLUMN IF NOT EXISTS failure_reason TEXT;'));
    await db.execute(sql.raw('ALTER TABLE stories ADD COLUMN IF NOT EXISTS failure_stage VARCHAR(50);'));
    await db.execute(sql.raw('ALTER TABLE stories ADD COLUMN IF NOT EXISTS last_attempted_at TIMESTAMPTZ;'));
  } catch {
    // Ignored if column already exists
  }
}

export async function ensureDatabaseInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const alreadyInitialized = await isDatabaseInitialized();
      if (!alreadyInitialized) {
        await initializeDatabase();
        await seedDefaultSources();
      } else {
        const db = await getDb();
        try {
          await db.execute(sql.raw('ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS image_url text;'));
          await db.execute(sql.raw('ALTER TABLE articles ADD COLUMN IF NOT EXISTS image_url text;'));
          await db.execute(sql.raw('ALTER TABLE stories ADD COLUMN IF NOT EXISTS processing_status VARCHAR(50) NOT NULL DEFAULT \'pending\';'));
          await db.execute(sql.raw('ALTER TABLE stories ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;'));
          await db.execute(sql.raw('ALTER TABLE stories ADD COLUMN IF NOT EXISTS failure_reason TEXT;'));
          await db.execute(sql.raw('ALTER TABLE stories ADD COLUMN IF NOT EXISTS failure_stage VARCHAR(50);'));
          await db.execute(sql.raw('ALTER TABLE stories ADD COLUMN IF NOT EXISTS last_attempted_at TIMESTAMPTZ;'));
        } catch {
          // Ignored if column exists
        }
      }
      if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
        const { seedDemoArticlesIfEmpty } = await import('../server/db/seeds/demo-articles');
        await seedDemoArticlesIfEmpty();
      }
    })();
  }
  return initPromise;
}

export function resetInitForTesting(): void {
  initPromise = null;
}
