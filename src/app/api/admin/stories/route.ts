import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../../../db';
import * as schema from '../../../../db/schema';
import { ensureDatabaseInitialized } from '../../../../db/init';
import { eq, desc } from 'drizzle-orm';
import { verifyAdminSecret } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const directHeader =
      request.headers.get('admin_api_secret') ||
      request.headers.get('x-admin-secret') ||
      request.headers.get('admin-api-secret');
    const authHeader = request.headers.get('authorization');
    const token =
      directHeader ||
      (authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null) ||
      request.cookies.get('nakshatra_admin_token')?.value;

    if (!verifyAdminSecret(token)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await ensureDatabaseInitialized();
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const status = (searchParams.get('status') || 'needs_review') as any;

    const rawStories = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.editorialStatus, status))
      .orderBy(desc(schema.stories.importanceScore), desc(schema.stories.firstSeenAt));

    const storiesWithSources = await Promise.all(
      rawStories.map(async (story) => {
        const sourcesJunction = await db
          .select({
            id: schema.storySources.id,
            isPrimary: schema.storySources.isPrimary,
            rawArticleId: schema.rawArticles.id,
            title: schema.rawArticles.title,
            canonicalUrl: schema.rawArticles.canonicalUrl,
            sourceName: schema.sources.name,
            sourceTier: schema.sources.tier,
          })
          .from(schema.storySources)
          .innerJoin(schema.rawArticles, eq(schema.storySources.rawArticleId, schema.rawArticles.id))
          .innerJoin(schema.sources, eq(schema.rawArticles.sourceId, schema.sources.id))
          .where(eq(schema.storySources.storyId, story.id));

        return {
          ...story,
          sources: sourcesJunction,
        };
      })
    );

    return NextResponse.json({
      success: true,
      count: storiesWithSources.length,
      stories: storiesWithSources,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to fetch stories' },
      { status: 500 }
    );
  }
}
