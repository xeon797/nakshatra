import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';
import { RssFeedAdapter, ParsedFeedItem } from '../../services/ingestion/rss-adapter';
import { seedSources } from '../db/seeds/sources';

export interface SourceFetchReport {
  sourceId: string;
  sourceName: string;
  baseUrl: string;
  tier: string;
  primaryCategory: string;
  status: 'success' | 'failed';
  itemsCount: number;
  latencyMs: number;
  error?: string;
  newestItemDate?: Date;
  oldestItemDate?: Date;
  sampleHeadlines: string[];
}

export interface CategoryCoverageSummary {
  category: 'llm_release' | 'agentic' | 'infra' | 'research' | 'policy';
  sourceCount: number;
  articleCount: number;
  sampleHeadlines: string[];
}

export interface DiagnosticResult {
  timestamp: string;
  activeSourcesCount: number;
  successfullyFetchedCount: number;
  failedCount: number;
  totalArticlesDiscovered: number;
  uniqueArticlesEstimated: number;
  newestContentTimestamp: string | null;
  oldestContentTimestamp: string | null;
  sourceReports: SourceFetchReport[];
  categoryBreakdown: Record<string, CategoryCoverageSummary>;
  agenticHealthVerdict: string;
  policyHealthVerdict: string;
}

export function classifyHeadlineCategory(
  title: string,
  summary: string,
  sourceCategory?: string
): 'llm_release' | 'agentic' | 'infra' | 'research' | 'policy' {
  const text = `${title} ${summary}`.toLowerCase();

  // 1. Policy & Governance keywords
  if (
    text.includes('policy') ||
    text.includes('regulation') ||
    text.includes('copyright') ||
    text.includes('lawsuit') ||
    text.includes('eu ai act') ||
    text.includes('ftc') ||
    text.includes('safety standard') ||
    text.includes('national security') ||
    text.includes('governance') ||
    text.includes('cset') ||
    text.includes('antitrust')
  ) {
    return 'policy';
  }

  // 2. Agentic keywords
  if (
    text.includes('agent') ||
    text.includes('agents') ||
    text.includes('agentic') ||
    text.includes('workflow') ||
    text.includes('langchain') ||
    text.includes('copilot') ||
    text.includes('tool use') ||
    text.includes('autonomous') ||
    text.includes('mcp')
  ) {
    return 'agentic';
  }

  // 3. Infrastructure keywords
  if (
    text.includes('gpu') ||
    text.includes('nvidia') ||
    text.includes('datacenter') ||
    text.includes('cluster') ||
    text.includes('blackwell') ||
    text.includes('h100') ||
    text.includes('b200') ||
    text.includes('aws') ||
    text.includes('azure') ||
    text.includes('semiconductor') ||
    text.includes('silicon') ||
    text.includes('chip')
  ) {
    return 'infra';
  }

  // 4. LLM Release keywords
  if (
    text.includes('gpt-') ||
    text.includes('claude') ||
    text.includes('gemini') ||
    text.includes('llama') ||
    text.includes('flagship llm') ||
    text.includes('model release') ||
    text.includes('open weights') ||
    text.includes('frontier model') ||
    text.includes('deepseek-') ||
    text.includes('mistral') ||
    text.includes('qwen')
  ) {
    return 'llm_release';
  }

  // 5. Research keywords
  if (
    text.includes('arxiv') ||
    text.includes('benchmark') ||
    text.includes('dataset') ||
    text.includes('reasoning') ||
    text.includes('mathematical') ||
    text.includes('evaluat') ||
    text.includes('paper') ||
    text.includes('proof') ||
    text.includes('theorem')
  ) {
    return 'research';
  }

  // 5. Default to source's primaryCategory if available
  if (
    sourceCategory &&
    ['llm_release', 'agentic', 'infra', 'research', 'policy'].includes(sourceCategory)
  ) {
    return sourceCategory as 'llm_release' | 'agentic' | 'infra' | 'research' | 'policy';
  }

  return 'llm_release';
}

export async function runSourceCatalogDiagnostic(options?: {
  adapter?: RssFeedAdapter;
  syncBeforeRun?: boolean;
}): Promise<DiagnosticResult> {
  const db = await getDb();
  if (options?.syncBeforeRun) {
    await seedSources();
  }

  const activeSources = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.isActive, true));

  const adapter = options?.adapter || new RssFeedAdapter(12000);
  const reports: SourceFetchReport[] = [];
  const allParsedItems: { item: ParsedFeedItem; sourceCategory: string; sourceName: string }[] = [];

  let newestDate: Date | null = null;
  let oldestDate: Date | null = null;

  for (const source of activeSources) {
    const rules = (source.scrapeRulesJson as Record<string, unknown>) || {};
    const primaryCategory = (rules.primaryCategory as string) || 'llm_release';
    const startMs = Date.now();

    try {
      const items = await adapter.parseUrl(source.baseUrl);
      const latencyMs = Date.now() - startMs;

      let sNewest: Date | undefined;
      let sOldest: Date | undefined;

      if (items.length > 0) {
        sNewest = items[0].publishedAt;
        sOldest = items[items.length - 1].publishedAt;

        if (!newestDate || sNewest > newestDate) newestDate = sNewest;
        if (!oldestDate || sOldest < oldestDate) oldestDate = sOldest;

        for (const item of items) {
          allParsedItems.push({ item, sourceCategory: primaryCategory, sourceName: source.name });
        }
      }

      reports.push({
        sourceId: source.id,
        sourceName: source.name,
        baseUrl: source.baseUrl,
        tier: source.tier,
        primaryCategory,
        status: 'success',
        itemsCount: items.length,
        latencyMs,
        newestItemDate: sNewest,
        oldestItemDate: sOldest,
        sampleHeadlines: items.slice(0, 3).map((i) => i.title),
      });
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      const errMsg = err instanceof Error ? err.message : String(err);
      reports.push({
        sourceId: source.id,
        sourceName: source.name,
        baseUrl: source.baseUrl,
        tier: source.tier,
        primaryCategory,
        status: 'failed',
        itemsCount: 0,
        latencyMs,
        error: errMsg,
        sampleHeadlines: [],
      });
    }
  }

  // Deduplication estimation by contentHash and canonicalUrl
  const seenUrls = new Set<string>();
  const seenHashes = new Set<string>();
  let uniqueCount = 0;

  const categoryBuckets: Record<string, { count: number; samples: string[]; sources: Set<string> }> = {
    llm_release: { count: 0, samples: [], sources: new Set() },
    agentic: { count: 0, samples: [], sources: new Set() },
    infra: { count: 0, samples: [], sources: new Set() },
    research: { count: 0, samples: [], sources: new Set() },
    policy: { count: 0, samples: [], sources: new Set() },
  };

  for (const { item, sourceCategory, sourceName } of allParsedItems) {
    if (!seenUrls.has(item.canonicalUrl) && !seenHashes.has(item.contentHash)) {
      seenUrls.add(item.canonicalUrl);
      seenHashes.add(item.contentHash);
      uniqueCount++;

      const detectedCat = classifyHeadlineCategory(item.title, item.cleanText, sourceCategory);
      const bucket = categoryBuckets[detectedCat] || categoryBuckets.llm_release;
      bucket.count++;
      bucket.sources.add(sourceName);
      if (bucket.samples.length < 5) {
        bucket.samples.push(`[${sourceName}] ${item.title}`);
      }
    }
  }

  const categoryBreakdown: Record<string, CategoryCoverageSummary> = {};
  for (const [cat, data] of Object.entries(categoryBuckets)) {
    categoryBreakdown[cat] = {
      category: cat as CategoryCoverageSummary['category'],
      sourceCount: data.sources.size,
      articleCount: data.count,
      sampleHeadlines: data.samples,
    };
  }

  const agenticHealthVerdict =
    categoryBreakdown.agentic.articleCount >= 5
      ? `HEALTHY: ${categoryBreakdown.agentic.articleCount} candidate articles discovered across ${categoryBreakdown.agentic.sourceCount} distinct sources.`
      : `STARVED: Only ${categoryBreakdown.agentic.articleCount} agentic candidate articles found.`;

  const policyHealthVerdict =
    categoryBreakdown.policy.articleCount >= 5
      ? `HEALTHY: ${categoryBreakdown.policy.articleCount} candidate articles discovered across ${categoryBreakdown.policy.sourceCount} distinct sources.`
      : `STARVED: Only ${categoryBreakdown.policy.articleCount} policy candidate articles found.`;

  return {
    timestamp: new Date().toISOString(),
    activeSourcesCount: activeSources.length,
    successfullyFetchedCount: reports.filter((r) => r.status === 'success').length,
    failedCount: reports.filter((r) => r.status === 'failed').length,
    totalArticlesDiscovered: allParsedItems.length,
    uniqueArticlesEstimated: uniqueCount,
    newestContentTimestamp: newestDate ? newestDate.toISOString() : null,
    oldestContentTimestamp: oldestDate ? oldestDate.toISOString() : null,
    sourceReports: reports,
    categoryBreakdown,
    agenticHealthVerdict,
    policyHealthVerdict,
  };
}
