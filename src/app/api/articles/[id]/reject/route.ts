import { NextRequest, NextResponse } from 'next/server';
import { ArticleManager } from '../../../../../services/editorial/article-manager';
import { ensureDatabaseInitialized } from '../../../../../db/init';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDatabaseInitialized();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || 'Rejected by editor review';

    const manager = new ArticleManager();
    await manager.rejectArticle(id, 'editor_admin', reason);

    return NextResponse.json({ success: true, message: 'Article rejected' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Rejection failed';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
