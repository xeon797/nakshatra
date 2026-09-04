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
    const manager = new ArticleManager();
    await manager.approveArticle(id, 'editor_admin');

    return NextResponse.json({ success: true, message: 'Article approved and published' });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Approval failed' },
      { status: 500 }
    );
  }
}
