import { z } from 'zod';
import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq, desc, gte, and } from 'drizzle-orm';
import { Resend } from 'resend';
import { renderDailyDigestHtml, EmailStoryItem, DailyDigestEmailProps } from '../../emails/daily-digest';

export const SubscribeSchema = z.object({
  email: z.string().email('Please enter a valid email address').max(255),
  topics: z.array(z.string()).default(['all']),
});

export type SubscribeInput = z.infer<typeof SubscribeSchema>;

export interface DailyDigestResult {
  success: boolean;
  storiesCompiled: number;
  subscribersMatched: number;
  emailsSent: number;
  emailsSkipped: number;
  errors: string[];
  mockMode: boolean;
  topStoryTitle?: string;
}

export class NewsletterService {
  private resendClient: Resend | null = null;
  private isMock: boolean = false;

  constructor(options?: { resendApiKey?: string; resendClient?: any }) {
    if (options?.resendClient) {
      this.resendClient = options.resendClient;
      this.isMock = false;
      return;
    }

    const key = options?.resendApiKey || process.env.RESEND_API_KEY;
    if (key && key.trim().length > 0 && !key.includes('placeholder')) {
      this.resendClient = new Resend(key);
      this.isMock = false;
    } else {
      // Safe mock fallback for local development and tests
      this.resendClient = null;
      this.isMock = true;
    }
  }

  /**
   * Subscribes an email to the newsletter with specific topic preferences
   */
  async subscribe(input: SubscribeInput): Promise<{
    success: boolean;
    subscriber: typeof schema.subscribers.$inferSelect;
    isNew: boolean;
  }> {
    const validated = SubscribeSchema.parse(input);
    const normalizedEmail = validated.email.trim().toLowerCase();
    const topics = validated.topics.length > 0 ? validated.topics : ['all'];

    const db = await getDb();

    // Check if subscriber already exists
    const [existing] = await db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.email, normalizedEmail))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(schema.subscribers)
        .set({
          topics,
          isActive: true,
          unsubscribedAt: null,
        })
        .where(eq(schema.subscribers.id, existing.id))
        .returning();

      return {
        success: true,
        subscriber: updated,
        isNew: false,
      };
    }

    // Insert new subscriber
    const [inserted] = await db
      .insert(schema.subscribers)
      .values({
        email: normalizedEmail,
        topics,
        isActive: true,
        isVerified: true,
      })
      .returning();

    return {
      success: true,
      subscriber: inserted,
      isNew: true,
    };
  }

  /**
   * Compiles the digest payload from the top stories in the database
   */
  async compileDigestPayload(lookbackHours = 24): Promise<DailyDigestEmailProps> {
    const db = await getDb();
    const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    // Query published articles from the lookback period
    let articleRows = await db
      .select({
        article: schema.articles,
        story: schema.stories,
      })
      .from(schema.articles)
      .leftJoin(schema.stories, eq(schema.articles.storyId, schema.stories.id))
      .where(
        and(
          eq(schema.articles.status, 'published'),
          gte(schema.articles.publishedAt, cutoff)
        )
      )
      .orderBy(desc(schema.stories.importanceScore), desc(schema.articles.publishedAt))
      .limit(15);

    // Fallback: If no articles published in last 24h, take latest published articles
    if (articleRows.length === 0) {
      articleRows = await db
        .select({
          article: schema.articles,
          story: schema.stories,
        })
        .from(schema.articles)
        .leftJoin(schema.stories, eq(schema.articles.storyId, schema.stories.id))
        .where(eq(schema.articles.status, 'published'))
        .orderBy(desc(schema.articles.publishedAt))
        .limit(10);
    }

    // Map each article into an EmailStoryItem
    const storyItems: EmailStoryItem[] = [];

    for (const { article, story } of articleRows) {
      let sourceNames: string[] = [];
      if (story) {
        const sources = await db
          .select({ name: schema.sources.name })
          .from(schema.storySources)
          .innerJoin(schema.rawArticles, eq(schema.storySources.rawArticleId, schema.rawArticles.id))
          .innerJoin(schema.sources, eq(schema.rawArticles.sourceId, schema.sources.id))
          .where(eq(schema.storySources.storyId, story.id));

        sourceNames = Array.from(new Set(sources.map((s) => s.name)));
      }

      if (sourceNames.length === 0) {
        const citations = await db
          .select({ name: schema.articleCitations.sourcePublisher })
          .from(schema.articleCitations)
          .where(eq(schema.articleCitations.articleId, article.id));

        sourceNames = Array.from(new Set(citations.map((c) => c.name)));
      }

      const category = story?.category || 'llm_release';

      storyItems.push({
        id: article.id,
        title: article.title,
        slug: article.slug,
        deck: article.deck,
        category,
        sourceNames,
        readingTimeMinutes: article.readingTimeMinutes,
        importanceScore: story?.importanceScore || 80,
      });
    }

    // Top story is item with highest importance score
    const topStory = storyItems.length > 0 ? storyItems[0] : undefined;
    const remainingStories = storyItems.length > 1 ? storyItems.slice(1) : [];

    // Group into Category Highlights
    const categoryMap: Record<string, { label: string; stories: EmailStoryItem[] }> = {
      llm_release: { label: 'Models & LLMs', stories: [] },
      agentic: { label: 'Autonomous Agents', stories: [] },
      infra: { label: 'AI Infrastructure', stories: [] },
      research: { label: 'Research Papers', stories: [] },
      policy: { label: 'Policy & Safety', stories: [] },
    };

    const quickHits: EmailStoryItem[] = [];

    for (const s of remainingStories) {
      if (categoryMap[s.category]) {
        categoryMap[s.category].stories.push(s);
      } else {
        quickHits.push(s);
      }
    }

    const categoryHighlights = Object.entries(categoryMap)
      .filter(([_, cat]) => cat.stories.length > 0)
      .map(([category, cat]) => ({
        category,
        categoryLabel: cat.label,
        stories: cat.stories,
      }));

    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    return {
      dateStr,
      topStory,
      categoryHighlights,
      quickHits,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://nakshatra.ai',
    };
  }

  /**
   * Sends the daily digest to active subscribers matching topics
   */
  async sendDailyDigest(options?: {
    lookbackHours?: number;
    subscribersOverride?: Array<typeof schema.subscribers.$inferSelect>;
  }): Promise<DailyDigestResult> {
    const db = await getDb();
    const digestPayload = await this.compileDigestPayload(options?.lookbackHours ?? 24);

    const activeSubscribers =
      options?.subscribersOverride ||
      (await db
        .select()
        .from(schema.subscribers)
        .where(eq(schema.subscribers.isActive, true)));

    const result: DailyDigestResult = {
      success: true,
      storiesCompiled:
        (digestPayload.topStory ? 1 : 0) +
        digestPayload.categoryHighlights.reduce((sum, c) => sum + c.stories.length, 0) +
        digestPayload.quickHits.length,
      subscribersMatched: 0,
      emailsSent: 0,
      emailsSkipped: 0,
      errors: [],
      mockMode: this.isMock,
      topStoryTitle: digestPayload.topStory?.title,
    };

    if (activeSubscribers.length === 0) {
      return result;
    }

    const htmlContent = renderDailyDigestHtml(digestPayload);
    const subject = `NAKSHATRA Daily: ${digestPayload.topStory?.title || 'Frontier AI Intelligence Briefing'}`;

    for (const sub of activeSubscribers) {
      // Check if subscriber wants this content
      const userTopics = sub.topics || [];
      const matchesTopic =
        userTopics.includes('all') ||
        userTopics.length === 0 ||
        digestPayload.categoryHighlights.some((c) => userTopics.includes(c.category)) ||
        (digestPayload.topStory && userTopics.includes(digestPayload.topStory.category));

      if (!matchesTopic) {
        result.emailsSkipped++;
        continue;
      }

      result.subscribersMatched++;

      if (this.isMock || !this.resendClient) {
        // Safe mock delivery
        result.emailsSent++;
      } else {
        try {
          await this.resendClient.emails.send({
            from: process.env.NEWSLETTER_FROM_EMAIL || 'briefings@nakshatra.ai',
            to: sub.email,
            subject,
            html: htmlContent,
          });
          result.emailsSent++;
        } catch (err: any) {
          result.errors.push(`Failed to send to ${sub.email}: ${err.message || String(err)}`);
        }
      }
    }

    return result;
  }
}
