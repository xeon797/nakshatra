import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { getDb } from '../src/db';
import * as schema from '../src/db/schema';

async function checkCounts() {
  const db = await getDb();
  const rawCount = await db.select().from(schema.rawArticles);
  const clusterCount = await db.select().from(schema.storyClusters);
  const storyCount = await db.select().from(schema.stories);
  const storySourcesCount = await db.select().from(schema.storySources);
  const publishedArticles = await db.select().from(schema.articles);

  console.log('--- PRODUCTION DB COUNTS ---');
  console.log(`Raw Articles:     ${rawCount.length}`);
  console.log(`Story Clusters:   ${clusterCount.length}`);
  console.log(`Stories:          ${storyCount.length}`);
  console.log(`Story Sources:    ${storySourcesCount.length}`);
  console.log(`Articles:         ${publishedArticles.length}`);

  if (rawCount.length > 0) {
    console.log('\nSample raw article:', {
      title: rawCount[0].title,
      sourceId: rawCount[0].sourceId,
      createdAt: rawCount[0].createdAt,
      publishedAt: rawCount[0].publishedAt,
    });
  }

  if (storyCount.length > 0) {
    console.log('\nSample story:', {
      title: storyCount[0].title,
      editorialStatus: storyCount[0].editorialStatus,
      category: storyCount[0].category,
    });
  }

  process.exit(0);
}

checkCounts().catch(console.error);
