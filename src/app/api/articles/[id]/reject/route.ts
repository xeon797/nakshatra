import { NextRequest, NextResponse } from 'next/server';
import { ArticleManager } from '../../../../../services/editorial/article-manager';
import { initializeDatabase } from '../../../../../db/init';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initializeDatabase();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || 'Rejected by editor review';

    const manager = new ArticleManager();
    await manager.rejectArticle(id, 'editor_admin', reason);

    return NextResponse.json({ success: true, message: 'Article rejected' });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Rejection failed' },
      { status: 500 }
    );
  }
}
