import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  numeric,
  jsonb,
  uuid,
  index,
  primaryKey,
  unique,
  pgEnum,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Vector custom type for pgvector compatibility
export const pgVector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string | number[]): number[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const cleaned = value.replace(/[\[\]]/g, '');
        return cleaned.split(',').map((n) => parseFloat(n.trim()));
      } catch {
        return [];
      }
    }
    return [];
  },
});

// 1. Ingestion Sources
export const sources = pgTable('sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  baseUrl: varchar('base_url', { length: 500 }).notNull().unique(),
  sourceType: varchar('source_type', { length: 50 }).notNull().default('rss'),
  tier: varchar('tier', { length: 50 }).notNull().default('tier_2_verified'),
  reputationScore: numeric('reputation_score', { precision: 3, scale: 2 }).notNull().default('0.80'),
  isActive: boolean('is_active').notNull().default(true),
  pollingFrequencyMinutes: integer('polling_frequency_minutes').notNull().default(15),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
  scrapeRulesJson: jsonb('scrape_rules_json').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 2. Raw Articles
export const rawArticles = pgTable(
  'raw_articles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
    externalId: varchar('external_id', { length: 500 }),
    canonicalUrl: varchar('canonical_url', { length: 1000 }).notNull().unique(),
    title: text('title').notNull(),
    authors: text('authors').array(),
    rawContent: text('raw_content').notNull(),
    cleanText: text('clean_text').notNull(),
    summaryExcerpt: text('summary_excerpt'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    simhashFingerprint: varchar('simhash_fingerprint', { length: 64 }),
    processingStatus: varchar('processing_status', { length: 50 }).notNull().default('ingested'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_raw_articles_content_hash').on(table.contentHash),
    index('idx_raw_articles_canonical_url').on(table.canonicalUrl),
  ]
);

// 3. Story Clusters
export const storyClusters = pgTable('story_clusters', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 500 }).notNull(),
  slug: varchar('slug', { length: 500 }).notNull().unique(),
  summary: text('summary').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('active'),
  velocityScore: numeric('velocity_score', { precision: 5, scale: 2 }).notNull().default('1.00'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
  lastEventAt: timestamp('last_event_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Junction: Story Clusters <-> Raw Articles
export const storyClusterSources = pgTable(
  'story_cluster_sources',
  {
    storyClusterId: uuid('story_cluster_id').notNull().references(() => storyClusters.id, { onDelete: 'cascade' }),
    rawArticleId: uuid('raw_article_id').notNull().references(() => rawArticles.id, { onDelete: 'cascade' }),
    isPrimarySource: boolean('is_primary_source').notNull().default(false),
    relevanceScore: numeric('relevance_score', { precision: 3, scale: 2 }).notNull().default('1.00'),
  },
  (table) => [
    primaryKey({ columns: [table.storyClusterId, table.rawArticleId] }),
  ]
);

// 4. Claims
export const claims = pgTable('claims', {
  id: uuid('id').defaultRandom().primaryKey(),
  storyClusterId: uuid('story_cluster_id').notNull().references(() => storyClusters.id, { onDelete: 'cascade' }),
  claimText: text('claim_text').notNull(),
  claimType: varchar('claim_type', { length: 100 }).notNull(),
  extractedFromRawId: uuid('extracted_from_raw_id').references(() => rawArticles.id, { onDelete: 'set null' }),
  verificationStatus: varchar('verification_status', { length: 50 }).notNull().default('unverified'),
  confidenceScore: numeric('confidence_score', { precision: 3, scale: 2 }).notNull().default('0.00'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 5. Evidences
export const evidences = pgTable('evidences', {
  id: uuid('id').defaultRandom().primaryKey(),
  claimId: uuid('claim_id').notNull().references(() => claims.id, { onDelete: 'cascade' }),
  sourceUrl: varchar('source_url', { length: 1000 }).notNull(),
  sourceName: varchar('source_name', { length: 255 }).notNull(),
  sourceTier: varchar('source_tier', { length: 50 }).notNull().default('tier_2_verified'),
  verbatimExcerpt: text('verbatim_excerpt').notNull(),
  entailment: varchar('entailment', { length: 50 }).notNull(),
  rationale: text('rationale').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).defaultNow().notNull(),
});

// 6. Synthesized Articles
export const articles = pgTable(
  'articles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storyClusterId: uuid('story_cluster_id').references(() => storyClusters.id, { onDelete: 'set null' }),
    storyId: uuid('story_id').references(() => stories.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull().unique(),
    deck: text('deck').notNull(),
    contentMarkdown: text('content_markdown').notNull(),
    titleEn: varchar('title_en', { length: 255 }).notNull().default(''),
    titleBn: varchar('title_bn', { length: 255 }).notNull().default(''),
    summaryEn: text('summary_en').notNull().default(''),
    summaryBn: text('summary_bn').notNull().default(''),
    contentEn: text('content_en').notNull().default(''),
    contentBn: text('content_bn').notNull().default(''),
    keyTakeawaysEn: text('key_takeaways_en').array().notNull().default([]),
    keyTakeawaysBn: text('key_takeaways_bn').array().notNull().default([]),
    metaDescription: varchar('meta_description', { length: 320 }).notNull(),
    status: varchar('status', { length: 50 }).notNull().default('draft'),
    confidenceScore: numeric('confidence_score', { precision: 3, scale: 2 }).notNull().default('0.00'),
    nGramMaxSimilarity: numeric('n_gram_max_similarity', { precision: 3, scale: 2 }).notNull().default('0.00'),
    readingTimeMinutes: integer('reading_time_minutes').notNull().default(3),
    heroImageUrl: varchar('hero_image_url', { length: 1000 }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_articles_slug').on(table.slug),
    index('idx_articles_status_published').on(table.status, table.publishedAt),
  ]
);

// 7. Citations
export const articleCitations = pgTable('article_citations', {
  id: uuid('id').defaultRandom().primaryKey(),
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  claimId: uuid('claim_id').references(() => claims.id, { onDelete: 'set null' }),
  citationIndex: integer('citation_index').notNull(),
  anchorText: varchar('anchor_text', { length: 255 }).notNull(),
  primarySourceUrl: varchar('primary_source_url', { length: 1000 }).notNull(),
  sourcePublisher: varchar('source_publisher', { length: 255 }).notNull(),
});

// 8. Revisions / Diffs
export const articleRevisions = pgTable('article_revisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  editorUserId: varchar('editor_user_id', { length: 255 }).notNull(),
  diffSummary: text('diff_summary').notNull(),
  previousContent: text('previous_content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 9. Agent Observability Runs & Step Logs
export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  articleId: uuid('article_id').references(() => articles.id, { onDelete: 'set null' }),
  storyClusterId: uuid('story_cluster_id').references(() => storyClusters.id, { onDelete: 'set null' }),
  agentName: varchar('agent_name', { length: 100 }).notNull(),
  agentVersion: varchar('agent_version', { length: 50 }).notNull(),
  modelProvider: varchar('model_provider', { length: 50 }).notNull(),
  modelName: varchar('model_name', { length: 100 }).notNull(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  totalCostUsd: numeric('total_cost_usd', { precision: 8, scale: 6 }).notNull().default('0.000000'),
  latencyMs: integer('latency_ms').notNull().default(0),
  status: varchar('status', { length: 50 }).notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const agentStepLogs = pgTable('agent_step_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentRunId: uuid('agent_run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
  stepNumber: integer('step_number').notNull(),
  actionName: varchar('action_name', { length: 100 }).notNull(),
  inputPayload: jsonb('input_payload').notNull(),
  outputPayload: jsonb('output_payload').notNull(),
  rationale: text('rationale'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 10. Subscribers & Topics
export const subscribers = pgTable('subscribers', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  topics: text('topics').array().notNull().default([]),
  preferredLanguage: varchar('preferred_language', { length: 10 }).notNull().default('bn'),
  isActive: boolean('is_active').notNull().default(true),
  isVerified: boolean('is_verified').notNull().default(false),
  verificationToken: varchar('verification_token', { length: 255 }),
  unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const topics = pgTable('topics', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  description: text('description'),
});

export const topicSubscriptions = pgTable(
  'topic_subscriptions',
  {
    subscriberId: uuid('subscriber_id').notNull().references(() => subscribers.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id').notNull().references(() => topics.id, { onDelete: 'cascade' }),
    cadence: varchar('cadence', { length: 50 }).notNull().default('daily'),
  },
  (table) => [
    primaryKey({ columns: [table.subscriberId, table.topicId] }),
  ]
);

// 11. Multi-Source Story Clusters & Editorial Stories (Phase 2)
export const editorialStatusEnum = pgEnum('editorial_status', [
  'auto_approved',
  'needs_review',
  'rejected',
  'published',
]);

export const riskLevelEnum = pgEnum('risk_level', [
  'low',
  'medium',
  'high',
]);

export const stories = pgTable(
  'stories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: varchar('title', { length: 255 }).notNull(),
    summary: text('summary').notNull(),
    category: varchar('category', { length: 64 }).notNull(), // 'llm_release', 'research', 'infra', 'policy', 'agentic'
    editorialStatus: editorialStatusEnum('editorial_status').notNull().default('needs_review'),
    riskLevel: riskLevelEnum('risk_level').notNull(),
    importanceScore: integer('importance_score').notNull(), // 0-100
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).notNull(),
    primarySourceId: uuid('primary_source_id').references(() => sources.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('idx_stories_editorial_status').on(table.editorialStatus),
    index('idx_stories_category').on(table.category),
    index('idx_stories_first_seen_at').on(table.firstSeenAt),
  ]
);

export const storySources = pgTable(
  'story_sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
    rawArticleId: uuid('raw_article_id').notNull().references(() => rawArticles.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (table) => [
    unique('uq_story_sources_story_raw').on(table.storyId, table.rawArticleId),
    index('idx_story_sources_story_id').on(table.storyId),
    index('idx_story_sources_raw_article_id').on(table.rawArticleId),
  ]
);

// 12. System Locks (Concurrency control for cron / workers)
export const systemLocks = pgTable('system_locks', {
  lockName: varchar('lock_name', { length: 100 }).primaryKey(),
  lockedAt: timestamp('locked_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ownerId: varchar('owner_id', { length: 255 }),
});

// 13. Newsletter Campaigns (Delivery metrics log)
export const newsletterCampaigns = pgTable('newsletter_campaigns', {
  id: uuid('id').defaultRandom().primaryKey(),
  subjectEn: varchar('subject_en', { length: 500 }).notNull(),
  subjectBn: varchar('subject_bn', { length: 500 }).notNull(),
  sentCount: integer('sent_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  recipientsCount: integer('recipients_count').notNull().default(0),
  errorLog: text('error_log'),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
});

// Relations
export const sourcesRelations = relations(sources, ({ many }) => ({
  rawArticles: many(rawArticles),
  stories: many(stories),
}));

export const rawArticlesRelations = relations(rawArticles, ({ one, many }) => ({
  source: one(sources, {
    fields: [rawArticles.sourceId],
    references: [sources.id],
  }),
  clusterMappings: many(storyClusterSources),
  storyLinks: many(storySources),
}));

export const storyClustersRelations = relations(storyClusters, ({ many }) => ({
  sources: many(storyClusterSources),
  claims: many(claims),
  articles: many(articles),
}));

export const storiesRelations = relations(stories, ({ one, many }) => ({
  primarySource: one(sources, {
    fields: [stories.primarySourceId],
    references: [sources.id],
  }),
  sources: many(storySources),
  articles: many(articles),
}));

export const storySourcesRelations = relations(storySources, ({ one }) => ({
  story: one(stories, {
    fields: [storySources.storyId],
    references: [stories.id],
  }),
  rawArticle: one(rawArticles, {
    fields: [storySources.rawArticleId],
    references: [rawArticles.id],
  }),
}));

export const claimsRelations = relations(claims, ({ one, many }) => ({
  cluster: one(storyClusters, {
    fields: [claims.storyClusterId],
    references: [storyClusters.id],
  }),
  evidences: many(evidences),
  citations: many(articleCitations),
}));

export const articlesRelations = relations(articles, ({ one, many }) => ({
  cluster: one(storyClusters, {
    fields: [articles.storyClusterId],
    references: [storyClusters.id],
  }),
  story: one(stories, {
    fields: [articles.storyId],
    references: [stories.id],
  }),
  citations: many(articleCitations),
  revisions: many(articleRevisions),
  agentRuns: many(agentRuns),
}));
