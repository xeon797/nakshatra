import React from 'react';
import { notFound } from 'next/navigation';
import { ArticleManager } from '../../../services/editorial/article-manager';
import { ensureDatabaseInitialized } from '../../../db/init';
import type { Metadata } from 'next';
import { ArticleView } from '../../../components/article/ArticleView';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    await ensureDatabaseInitialized();
    const { slug } = await params;
    const manager = new ArticleManager();
    const article = await manager.getArticleBySlug(slug);

    if (!article) return { title: 'Article Not Found | NAKSHATRA' };

    return {
      title: `${article.title} | NAKSHATRA`,
      description: article.metaDescription,
      openGraph: {
        title: article.title,
        description: article.metaDescription,
        type: 'article',
        publishedTime: article.publishedAt ? new Date(article.publishedAt).toISOString() : undefined,
      },
    };
  } catch (err) {
    console.error('[generateMetadata] Error fetching article metadata:', err);
    return { title: 'NAKSHATRA | AI Intelligence' };
  }
}

export default async function ArticlePage({ params }: Props) {
  let article = null;
  try {
    await ensureDatabaseInitialized();
    const { slug } = await params;
    const manager = new ArticleManager();
    article = await manager.getArticleBySlug(slug);
  } catch (err) {
    console.error('[ArticlePage] Error fetching article:', err);
  }

  if (!article) {
    notFound();
  }

  // Schema.org JSON-LD structured data for SEO
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.metaDescription,
    datePublished: article.publishedAt
      ? new Date(article.publishedAt).toISOString()
      : new Date().toISOString(),
    author: {
      '@type': 'Organization',
      name: 'NAKSHATRA Autonomous Editorial Agent',
    },
    publisher: {
      '@type': 'Organization',
      name: 'NAKSHATRA',
      url: 'https://nakshatra.ai',
    },
  };

  const sanitizedJsonLd = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

  return (
    <>
      {/* JSON-LD Script */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: sanitizedJsonLd }}
      />

      <ArticleView article={article} />
    </>
  );
}
