import React from 'react';
import Link from 'next/link';
import { ArticleManager } from '../services/editorial/article-manager';
import { ensureDatabaseInitialized } from '../db/init';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, gte, sql } from 'drizzle-orm';
import { ShieldCheck, Mail, ArrowRight, Sparkles } from 'lucide-react';
import { PulseTicker } from '../components/home/PulseTicker';
import { HeroStory } from '../components/home/HeroStory';
import { NewsGridWithFilter, ArticleCardItem } from '../components/home/NewsGridWithFilter';
import { NewsletterCapture } from '../components/home/NewsletterCapture';

import { HomeFeedHeader, FeedSectionHeading } from '../components/home/HomeFeedHeader';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  await ensureDatabaseInitialized();
  const db = await getDb();

  // 1. Fetch live pulse statistics
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [activeSourcesRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.sources)
    .where(eq(schema.sources.isActive, true));

  const [ingestedTodayRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.rawArticles)
    .where(gte(schema.rawArticles.createdAt, todayStart));

  const activeSourcesCount = Number(activeSourcesRow?.count || 12);
  const storiesIngestedToday = Number(ingestedTodayRow?.count || 0);

  // 2. Fetch published articles with story and source metadata
  const articleManager = new ArticleManager();
  const rawPublishedArticles = await articleManager.getPublishedArticlesWithMetadata(40, 0);

  const articlesPublishedCount = rawPublishedArticles.length;

  // Format articles for client card display with bilingual properties
  const formattedArticles: ArticleCardItem[] = rawPublishedArticles.map((a) => ({
    id: a.id,
    title: a.title,
    titleEn: a.titleEn || a.title,
    titleBn: a.titleBn || a.title,
    slug: a.slug,
    deck: a.deck,
    summaryEn: a.summaryEn || a.deck,
    summaryBn: a.summaryBn || a.deck,
    category: a.story?.category || 'llm_release',
    riskLevel: a.story?.riskLevel || 'low',
    confidenceScore: a.confidenceScore,
    readingTimeMinutes: a.readingTimeMinutes,
    publishedAt: a.publishedAt,
    sources: a.sources,
  }));

  // 3. Hero Unit Selection: Highest importance score article from past 24h (or fallback)
  const now = Date.now();
  const last24hArticles = formattedArticles.filter((a) => {
    if (!a.publishedAt) return false;
    return now - new Date(a.publishedAt).getTime() < 24 * 60 * 60 * 1000;
  });

  const heroCandidatePool = last24hArticles.length > 0 ? last24hArticles : formattedArticles;

  let heroStory: ArticleCardItem | undefined = undefined;
  if (heroCandidatePool.length > 0) {
    heroStory = heroCandidatePool.reduce((prev, curr) => {
      const prevArticle = rawPublishedArticles.find((r) => r.id === prev.id);
      const currArticle = rawPublishedArticles.find((r) => r.id === curr.id);
      const prevScore = prevArticle?.story?.importanceScore ?? 75;
      const currScore = currArticle?.story?.importanceScore ?? 75;
      return currScore > prevScore ? curr : prev;
    }, heroCandidatePool[0]);
  }

  // Articles for the grid (excluding the hero if multiple exist)
  const gridArticles =
    formattedArticles.length > 1 && heroStory
      ? formattedArticles.filter((a) => a.id !== heroStory.id)
      : formattedArticles;

  return (
    <div className="space-y-10 pb-16">
      {/* 1. Top Section: Site Branding, Dynamic Date, and Quick Actions */}
      <HomeFeedHeader />

      {/* Live Pulse Ticker */}
      <PulseTicker
        storiesIngestedToday={storiesIngestedToday}
        activeSourcesCount={activeSourcesCount}
        articlesPublishedCount={articlesPublishedCount}
      />

      {/* 2. Hero Unit ("Top Story / Breaking") */}
      {heroStory ? (
        <HeroStory story={heroStory} />
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center space-y-4 bg-slate-950/40">
          <div className="w-12 h-12 rounded-full bg-slate-900 flex items-center justify-center mx-auto text-sky-400">
            <Sparkles className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-white">Continuous Autonomous Ingestion Active</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            The autonomous newsroom daemon is actively polling Tier 1 labs and arXiv pre-prints. Top breaking stories will appear here as soon as they are synthesized.
          </p>
          <Link
            href="/admin/newsroom"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-bold text-xs hover:bg-sky-400 transition-colors"
          >
            Open Newsroom Desk &rarr;
          </Link>
        </div>
      )}

      {/* 3. News Grid & Filtering (Topic Tabs + Search) */}
      <section className="space-y-6">
        <FeedSectionHeading />
        <NewsGridWithFilter articles={gridArticles} />
      </section>

      {/* 4. Embedded Newsletter Capture */}
      <NewsletterCapture />
    </div>
  );
}

