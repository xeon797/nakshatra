import { NextResponse } from 'next/server';
import { ArticleManager } from '../../../services/editorial/article-manager';
import { ensureDatabaseInitialized } from '../../../db/init';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await ensureDatabaseInitialized();
    const url = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '12', 10), 1), 50);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);
    const category = url.searchParams.get('category');
    const search = url.searchParams.get('search')?.trim().toLowerCase();

    const articleManager = new ArticleManager();
    const totalCount = await articleManager.countPublishedArticles();
    const articles = await articleManager.getPublishedArticlesWithMetadata(limit, offset);

    // Format for client consumption
    let filtered = articles;
    if (category && category !== 'all') {
      filtered = filtered.filter((a) => a.story?.category === category);
    }
    if (search) {
      filtered = filtered.filter((a) => {
        const text = [
          a.title,
          a.titleEn || '',
          a.titleBn || '',
          a.deck,
          a.summaryEn || '',
          a.summaryBn || '',
          ...a.sources.map((s) => s.name),
        ]
          .join(' ')
          .toLowerCase();
        return text.includes(search);
      });
    }

    const formattedArticles = filtered.map((a) => ({
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
      confidenceScore: a.confidenceScore || '0.95',
      readingTimeMinutes: a.readingTimeMinutes || 3,
      publishedAt: a.publishedAt,
      sources: a.sources || [],
      imageUrl: a.imageUrl || a.heroImageUrl || null,
    }));

    return NextResponse.json({
      success: true,
      articles: formattedArticles,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve published articles';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
