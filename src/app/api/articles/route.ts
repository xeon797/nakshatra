import { NextResponse } from 'next/server';
import { ArticleManager } from '../../../services/editorial/article-manager';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsedLimit = Number(url.searchParams.get('limit') ?? 12);
    const parsedOffset = Number(url.searchParams.get('offset') ?? 0);
    if (!Number.isSafeInteger(parsedLimit) || !Number.isSafeInteger(parsedOffset) || parsedLimit < 1 || parsedOffset < 0) {
      return NextResponse.json({ success: false, error: 'Invalid pagination parameters' }, { status: 400 });
    }
    const limit = Math.min(parsedLimit, 50);
    const offset = parsedOffset;
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
