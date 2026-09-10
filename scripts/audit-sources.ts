import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { getDb } from '../src/db';
import * as schema from '../src/db/schema';
import { HIGH_SIGNAL_AI_SOURCES } from '../src/server/db/seeds/sources';
import { RssFeedAdapter } from '../src/services/ingestion/rss-adapter';

async function audit() {
  console.log('=== STEP 1: AUDITING SOURCES IN DATABASE ===');
  let dbSources: (typeof schema.sources.$inferSelect)[] = [];
  try {
    const db = await getDb();
    dbSources = await db.select().from(schema.sources);
    console.log(`Found ${dbSources.length} sources in database:`);
    for (const s of dbSources) {
      console.log(`- [DB ID: ${s.id}] ${s.name} | URL: ${s.baseUrl} | active: ${s.isActive} | lastPolled: ${s.lastPolledAt}`);
    }
  } catch (err) {
    console.error('Error connecting to DB:', err);
  }

  console.log('\n=== STEP 2: AUDITING HIGH_SIGNAL_AI_SOURCES FROM seeds/sources.ts ===');
  console.log(`Total configured in seed: ${HIGH_SIGNAL_AI_SOURCES.length}`);

  const allAudited = new Map<string, { name: string; url: string; origin: string }>();
  for (const s of HIGH_SIGNAL_AI_SOURCES) {
    allAudited.set(s.baseUrl, { name: s.name, url: s.baseUrl, origin: 'seed' });
  }
  for (const s of dbSources) {
    if (!allAudited.has(s.baseUrl)) {
      allAudited.set(s.baseUrl, { name: s.name, url: s.baseUrl, origin: 'db-only' });
    } else {
      const existing = allAudited.get(s.baseUrl)!;
      allAudited.set(s.baseUrl, { ...existing, origin: 'seed+db' });
    }
  }

  console.log(`\nTotal unique source URLs to test: ${allAudited.size}`);

  const adapter = new RssFeedAdapter(15000);

  for (const [url, info] of allAudited.entries()) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`TESTING: ${info.name} (${info.origin})`);
    console.log(`URL: ${url}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'NAKSHATRA-AI-News-Bot/1.0 (+https://nakshatra.ai/bot)',
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        },
      });
      clearTimeout(timeout);
      console.log(`HTTP Status: ${res.status} ${res.statusText}`);
      console.log(`Content-Type: ${res.headers.get('content-type')}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`Raw HTTP Fetch Error: ${msg}`);
    }

    try {
      const items = await adapter.parseUrl(url);
      console.log(`PARSER RESULT: SUCCESS (${items.length} items parsed)`);
      if (items.length > 0) {
        const newest = items[0];
        const oldest = items[items.length - 1];
        console.log(`Newest Item Title: "${newest.title}"`);
        console.log(`Newest Item Date:  ${newest.publishedAt.toISOString()}`);
        console.log(`Oldest Item Date:  ${oldest.publishedAt.toISOString()}`);
        console.log(`Sample item 0 canonical URL: ${newest.canonicalUrl}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`PARSER RESULT: FAILED - ${msg}`);
    }
  }

  process.exit(0);
}

audit().catch((err) => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
