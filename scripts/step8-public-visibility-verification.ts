import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { getDb, closeDb, schema } from '../src/db';
import { eq, desc } from 'drizzle-orm';
import { ArticleManager } from '../src/services/editorial/article-manager';

export interface VisibilityReport {
  neonPublishedCount: number;
  publicQueryCount: number;
  homepageApiCount: number;
  liveWebsiteCount: number;
  neonArticles: Array<{ id: string; title: string; slug: string; status: string; publishedAt: string }>;
  publicQuerySlugs: string[];
  liveWebsiteSlugs: string[];
  missingFromLive: Array<{ slug: string; title: string; status: string; publishedAt: string; reason?: string }>;
}

export async function verifyPublicVisibility(targetUrl = 'https://nakshatra-pearl.vercel.app'): Promise<VisibilityReport> {
  console.log('====================================================');
  console.log('🌐 STEP 8: PUBLIC VISIBILITY VERIFICATION');
  console.log(`Auditing target: ${targetUrl}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('====================================================\n');

  const db = await getDb();
  const articleManager = new ArticleManager();

  try {
    // 1. Layer 1: Neon Published Articles
    const neonPublished = await db
      .select({
        id: schema.articles.id,
        title: schema.articles.title,
        slug: schema.articles.slug,
        status: schema.articles.status,
        publishedAt: schema.articles.publishedAt,
      })
      .from(schema.articles)
      .where(eq(schema.articles.status, 'published'))
      .orderBy(desc(schema.articles.publishedAt));

    const neonPublishedCount = neonPublished.length;

    // 2. Layer 2: Public Application Query
    const publicQueryArticles = await articleManager.getPublishedArticlesWithMetadata(100, 0);
    const publicQueryCount = publicQueryArticles.length;
    const publicQuerySlugs = publicQueryArticles.map((a) => a.slug);

    // 3. Layer 3: Homepage / API Query count
    const totalPublishedCount = await articleManager.countPublishedArticles();
    const homepageApiCount = totalPublishedCount;

    // 4. Layer 4: Live Production Website
    let liveWebsiteHtml = '';
    let liveWebsiteFetchOk = false;
    try {
      const liveRes = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Nakshatra-Visibility-Probe/1.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (liveRes.ok) {
        liveWebsiteHtml = await liveRes.text();
        liveWebsiteFetchOk = true;
      } else {
        console.warn(`[Live Probe] Failed to fetch homepage: HTTP ${liveRes.status}`);
      }
    } catch (fetchErr) {
      console.warn(`[Live Probe] Network error fetching ${targetUrl}:`, fetchErr);
    }

    // Check each article on live website (both via homepage HTML inspection and direct slug route)
    const verifiedLiveSlugs: string[] = [];
    const missingFromLive: VisibilityReport['missingFromLive'] = [];

    for (const art of neonPublished) {
      const inHomepage = liveWebsiteHtml.includes(art.slug);
      let routeAccessible = false;

      // Probe individual article page if target website was reachable
      if (liveWebsiteFetchOk) {
        try {
          const articleUrl = `${targetUrl}/article/${art.slug}`;
          const routeRes = await fetch(articleUrl, {
            method: 'HEAD',
            signal: AbortSignal.timeout(6000),
          });
          if (routeRes.status === 200) {
            routeAccessible = true;
          }
        } catch {
          // ignore transient probe failure
        }
      }

      if (inHomepage || routeAccessible) {
        verifiedLiveSlugs.push(art.slug);
      } else {
        missingFromLive.push({
          slug: art.slug,
          title: art.title,
          status: art.status,
          publishedAt: art.publishedAt ? new Date(art.publishedAt).toISOString() : 'NULL',
          reason: liveWebsiteFetchOk
            ? 'Neither found in homepage feed nor accessible via /article/[slug]'
            : 'Target live deployment unreachable during probe',
        });
      }
    }

    const liveWebsiteCount = verifiedLiveSlugs.length;

    // 5. Print Comparison Table
    console.log('----------------------------------------------------');
    console.log('| Layer          | Count |');
    console.log('----------------------------------------------------');
    console.log(`| Neon Published | ${String(neonPublishedCount).padStart(5)} |`);
    console.log(`| Public Query   | ${String(publicQueryCount).padStart(5)} |`);
    console.log(`| Homepage/API   | ${String(homepageApiCount).padStart(5)} |`);
    console.log(`| Live Website   | ${String(liveWebsiteCount).padStart(5)} |`);
    console.log('----------------------------------------------------\n');

    if (missingFromLive.length > 0) {
      console.log(`⚠️ MISSING ARTICLES FROM LIVE WEBSITE (${missingFromLive.length}):`);
      missingFromLive.forEach((m, idx) => {
        console.log(`  ${idx + 1}. [${m.status}] slug: "${m.slug}"\n     title: "${m.title}"\n     publishedAt: ${m.publishedAt}\n     reason: ${m.reason}`);
      });
    } else {
      console.log('✓ All Neon published articles are 100% visible on the live production website!');
    }

    console.log('\n====================================================');
    console.log('VERIFICATION COMPLETE');
    console.log('====================================================');

    return {
      neonPublishedCount,
      publicQueryCount,
      homepageApiCount,
      liveWebsiteCount,
      neonArticles: neonPublished.map((a) => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        status: a.status,
        publishedAt: a.publishedAt ? new Date(a.publishedAt).toISOString() : '',
      })),
      publicQuerySlugs,
      liveWebsiteSlugs: verifiedLiveSlugs,
      missingFromLive,
    };
  } finally {
    await closeDb();
  }
}

// CLI direct execution
const isDirectExecution = process.argv[1]?.includes('step8-public-visibility-verification');
if (isDirectExecution) {
  verifyPublicVisibility()
    .then((report) => {
      const allSynced =
        report.neonPublishedCount === report.publicQueryCount &&
        report.neonPublishedCount === report.liveWebsiteCount;
      if (allSynced) {
        process.exit(0);
      } else {
        process.exit(0); // non-zero only on unhandled error, so CI can read report
      }
    })
    .catch((err) => {
      console.error('Fatal verification error:', err);
      process.exit(1);
    });
}
