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
    const manager = new ArticleManager();
    await manager.approveArticle(id, 'editor_admin');

    return NextResponse.json({ success: true, message: 'Article approved and published' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Approval failed';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
