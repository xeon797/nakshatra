import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../../../../../db';
import * as schema from '../../../../../../db/schema';
import { ensureDatabaseInitialized } from '../../../../../../db/init';
import { eq } from 'drizzle-orm';
import { verifyAdminSecret } from '../../../../../../lib/auth';
import { MultiSourceResearcherAgent } from '../../../../../../server/agents/researcher';
import { MultiSourceWriterAgent } from '../../../../../../server/agents/writer';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;
    const db = await getDb();

    // 1. Verify story exists
    const [story] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, id))
      .limit(1);

    if (!story) {
      return NextResponse.json({ success: false, error: `Story ${id} not found` }, { status: 404 });
    }

    // 2. Transition status to auto_approved and reset failure retry state
    await db
      .update(schema.stories)
      .set({
        editorialStatus: 'auto_approved',
        processingStatus: 'processing',
        retryCount: 0,
        failureReason: null,
        failureStage: null,
        lastAttemptedAt: new Date(),
        lastUpdatedAt: new Date(),
      })
      .where(eq(schema.stories.id, id));

    // 3. Dispatch Researcher & Writer Agent to produce article
    const researcher = new MultiSourceResearcherAgent();
    const writer = new MultiSourceWriterAgent();

    const evidencePacket = await researcher.buildEvidencePacket(id);
    const generatedArticle = await writer.synthesizeStoryArticle(evidencePacket);

    return NextResponse.json({
      success: true,
      message: 'Story promoted and synthesized into article draft',
      storyId: id,
      articleId: generatedArticle.id,
      slug: generatedArticle.slug,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Promotion failed';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
