import { z } from 'zod';
import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq, desc, gte, and } from 'drizzle-orm';
import { Resend } from 'resend';
import { renderDailyDigestHtml, EmailStoryItem, DailyDigestEmailProps } from '../../emails/daily-digest';
import { renderDailyDigestBnHtml } from '../../emails/daily-digest-bn';

export const SubscribeSchema = z.object({
  email: z.string().email('Please enter a valid email address').max(255),
  topics: z.array(z.string()).default(['all']),
  preferredLanguage: z.enum(['en', 'bn']).default('bn'),
});

export type SubscribeInput = z.input<typeof SubscribeSchema>;

export interface DailyDigestResult {
  success: boolean;
  storiesCompiled: number;
  subscribersMatched: number;
  emailsSent: number;
  emailsSkipped: number;
  errors: string[];
  mockMode: boolean;
  topStoryTitle?: string;
  campaignId?: string;
}

export function getDefaultFromEmail(): string {
  if (process.env.NEWSLETTER_FROM_EMAIL && process.env.NEWSLETTER_FROM_EMAIL.trim().length > 0) {
    return process.env.NEWSLETTER_FROM_EMAIL;
  }
  return process.env.NODE_ENV === 'production'
    ? 'NAKSHATRA Dispatch <newsletter@nakshatra.news>'
    : 'NAKSHATRA Dispatch <onboarding@resend.dev>';
}

export interface ResendClientLike {
  emails: {
    send: (payload: {
      from: string;
      to: string;
      subject: string;
      html: string;
    }) => Promise<unknown>;
  };
}

export class NewsletterService {
  private resendClient: Resend | ResendClientLike | null = null;
  private isMock: boolean = false;

  constructor(options?: { resendApiKey?: string; resendClient?: Resend | ResendClientLike | null }) {
    if (options?.resendClient) {
      this.resendClient = options.resendClient;
      this.isMock = false;
      return;
    }

    const isTest = process.env.NODE_ENV === 'test';
    const key = options?.resendApiKey || (!isTest ? process.env.RESEND_API_KEY : undefined);
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
   * Subscribes an email to the newsletter with specific topic preferences and language
   */
  async subscribe(input: SubscribeInput): Promise<{
    success: boolean;
    subscriber: typeof schema.subscribers.$inferSelect;
    isNew: boolean;
  }> {
    const validated = SubscribeSchema.parse(input);
    const normalizedEmail = validated.email.trim().toLowerCase();
    const topics = validated.topics.length > 0 ? validated.topics : ['all'];
    const preferredLanguage = validated.preferredLanguage || 'bn';

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
          preferredLanguage,
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
        preferredLanguage,
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
        titleEn: article.titleEn || article.title,
        titleBn: article.titleBn || article.title,
        slug: article.slug,
        deck: article.deck,
        summaryEn: article.summaryEn || article.deck,
        summaryBn: article.summaryBn || article.deck,
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
      .filter(([, cat]) => cat.stories.length > 0)
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
   * Sends the daily digest to active subscribers matching topics, routed by preferred language
   */
  async sendDailyDigest(options?: {
    lookbackHours?: number;
    subscribersOverride?: Array<typeof schema.subscribers.$inferSelect>;
    recordCampaign?: boolean;
    batchDelayMs?: number;
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

    const enHtmlContent = renderDailyDigestHtml(digestPayload);
    const bnHtmlContent = renderDailyDigestBnHtml(digestPayload);
    const enSubject = `NAKSHATRA Daily: ${digestPayload.topStory?.titleEn || digestPayload.topStory?.title || 'Frontier AI Intelligence Briefing'}`;
    const bnSubject = `নক্ষত্র দৈনিক এআই ব্রিফিং: ${digestPayload.topStory?.titleBn || digestPayload.topStory?.title || 'ফ্রন্টিয়ার এআই ইন্টেলিজেন্স'}`;
    const fromAddress = getDefaultFromEmail();

    // 1. Filter subscribers matching preferences
    const matchingSubscribers: Array<typeof schema.subscribers.$inferSelect> = [];
    for (const sub of activeSubscribers) {
      const userTopics = sub.topics || [];
      const matchesTopic =
        userTopics.includes('all') ||
        userTopics.length === 0 ||
        digestPayload.categoryHighlights.some((c) => userTopics.includes(c.category)) ||
        (digestPayload.topStory && userTopics.includes(digestPayload.topStory.category));

      if (matchesTopic) {
        matchingSubscribers.push(sub);
      } else {
        result.emailsSkipped++;
      }
    }

    // 2. Batch processing in chunks of 50 with 250ms spacing between batches
    const CHUNK_SIZE = 50;
    const batchDelayMs = options?.batchDelayMs ?? (process.env.NODE_ENV === 'test' ? 0 : 250);

    for (let i = 0; i < matchingSubscribers.length; i += CHUNK_SIZE) {
      const batch = matchingSubscribers.slice(i, i + CHUNK_SIZE);

      for (const sub of batch) {
        result.subscribersMatched++;

        const isBn = sub.preferredLanguage === 'bn';
        const htmlContent = isBn ? bnHtmlContent : enHtmlContent;
        const subject = isBn ? bnSubject : enSubject;

        if (this.isMock || !this.resendClient) {
          if (process.env.NODE_ENV === 'development') {
            console.log(`[Mock Newsletter] Dispatching ${isBn ? 'Bengali' : 'English'} digest to ${sub.email}`);
          }
          result.emailsSent++;
        } else {
          try {
            await this.resendClient.emails.send({
              from: fromAddress,
              to: sub.email,
              subject,
              html: htmlContent,
            });
            result.emailsSent++;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result.errors.push(`Failed to send to ${sub.email}: ${message}`);
          }
        }
      }

      // 250ms pause between batches to prevent rate-limit rejections
      if (i + CHUNK_SIZE < matchingSubscribers.length && batchDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
      }
    }

    // 3. Optional campaign recording into newsletter_campaigns
    if (options?.recordCampaign) {
      try {
        const [campaign] = await db
          .insert(schema.newsletterCampaigns)
          .values({
            subjectEn: enSubject,
            subjectBn: bnSubject,
            sentCount: result.emailsSent,
            skippedCount: result.emailsSkipped,
            failedCount: result.errors.length,
            recipientsCount: activeSubscribers.length,
            errorLog: result.errors.length > 0 ? result.errors.slice(0, 10).join('; ') : null,
            sentAt: new Date(),
          })
          .returning();

        if (campaign) {
          result.campaignId = campaign.id;
        }
      } catch {
        // Fallback gracefully if database campaign recording encounters an issue
      }
    }

    return result;
  }
}
