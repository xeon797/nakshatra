import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractCleanMarkdown,
  searchSecondarySources,
  cleanExtractedMarkdown,
} from '../services/external-research';
import { NewsletterService, getDefaultFromEmail } from '../services/newsletter-service';
import { getDb, resetDbForTesting } from '../../db';
import { initializeDatabase } from '../../db/init';
import * as schema from '../../db/schema';

describe('External Service Integration Hardening (Resend, Jina Reader, Tavily)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Jina Reader Markdown Extraction
  // ───────────────────────────────────────────────────────────────────────────
  describe('Jina Reader Engine (extractCleanMarkdown)', () => {
    it('attaches Authorization: Bearer header when API key is provided', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};

      const mockFetch: typeof fetch = async (input, init) => {
        capturedUrl = input.toString();
        capturedHeaders = (init?.headers || {}) as Record<string, string>;

        return {
          ok: true,
          status: 200,
          text: async () =>
            '# OpenAI Operator\n\nFull clean markdown technical announcement regarding autonomous browser execution.',
        } as any;
      };

      const result = await extractCleanMarkdown(
        'https://openai.com/blog/operator',
        'Fallback excerpt',
        {
          apiKey: 'jina_test_key_sample_12345',
          fetchFn: mockFetch,
        }
      );

      expect(capturedUrl).toBe('https://r.jina.ai/https://openai.com/blog/operator');
      expect(capturedHeaders['Authorization']).toBe('Bearer jina_test_key_sample_12345');
      expect(capturedHeaders['X-Return-Format']).toBe('markdown');
      expect(result).toContain('OpenAI Operator');
      expect(result).toContain('Full clean markdown');
    });

    it('omits Authorization header when no key is provided', async () => {
      let capturedHeaders: Record<string, string> = {};

      const mockFetch: typeof fetch = async (_input, init) => {
        capturedHeaders = (init?.headers || {}) as Record<string, string>;
        return {
          ok: true,
          status: 200,
          text: async () => 'Clean markdown body without authorization header required.',
        } as any;
      };

      const result = await extractCleanMarkdown(
        'https://deepmind.google/discover/blog/alphageometry-2',
        'Fallback excerpt',
        {
          apiKey: '',
          fetchFn: mockFetch,
        }
      );

      expect(capturedHeaders['Authorization']).toBeUndefined();
      expect(capturedHeaders['X-Return-Format']).toBe('markdown');
      expect(result).toContain('Clean markdown body');
    });

    it('strips tracking URLs, scripts, styles, and navigation boilerplate', () => {
      const dirtyInput = `
        <script>window.alert("tracking");</script>
        <style>.ad-banner { display: block; }</style>
        [Skip to main content](#main)
        # Frontier Reasoning Models
        Read more at [Primary Lab](https://anthropic.com/news/claude-3-7?utm_source=twitter&utm_medium=social&ref=partner).
        [Cookie Preferences](#cookies)
      `;

      const cleaned = cleanExtractedMarkdown(dirtyInput);
      expect(cleaned).not.toContain('<script>');
      expect(cleaned).not.toContain('.ad-banner');
      expect(cleaned).not.toContain('utm_source');
      expect(cleaned).not.toContain('Cookie Preferences');
      expect(cleaned).toContain('# Frontier Reasoning Models');
      expect(cleaned).toContain('https://anthropic.com/news/claude-3-7');
    });

    it('falls back cleanly to fallbackText on HTTP error or network timeout', async () => {
      const mockFetchFailing: typeof fetch = async () => {
        throw new Error('Connection timed out');
      };

      const result = await extractCleanMarkdown(
        'https://example.com/unreachable-post',
        'Original RSS summary excerpt',
        {
          apiKey: 'jina_sample_key_99999',
          fetchFn: mockFetchFailing,
        }
      );

      expect(result).toBe('Original RSS summary excerpt');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Tavily Fact-Check & Discovery Engine
  // ───────────────────────────────────────────────────────────────────────────
  describe('Tavily Fact-Check & Discovery Engine (searchSecondarySources)', () => {
    it('returns normalized typed results prioritizing tech outlets', async () => {
      let capturedBody: any = null;

      const mockFetch: typeof fetch = async (_input, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                title: 'Anthropic unveils Claude 3.7 Sonnet',
                url: 'https://techcrunch.com/2026/02/anthropic-claude-3-7',
                content: 'TechCrunch reporting: Anthropic announced Claude 3.7 with hybrid reasoning.',
                score: 0.94,
              },
              {
                title: 'Claude 3.7: In-depth Analysis',
                url: 'https://arstechnica.com/ai/claude-3-7-review',
                content: 'Ars Technica confirms extended thinking benchmark performance.',
                score: 0.88,
              },
            ],
          }),
        } as any;
      };

      const results = await searchSecondarySources('Claude 3.7 hybrid reasoning benchmark', {
        apiKey: 'tvly-test-sample-key-12345',
        fetchFn: mockFetch,
      });

      expect(capturedBody).toBeDefined();
      expect(capturedBody.api_key).toBe('tvly-test-sample-key-12345');
      expect(capturedBody.search_depth).toBe('basic');
      expect(capturedBody.max_results).toBe(3);
      expect(capturedBody.include_domains).toContain('techcrunch.com');
      expect(capturedBody.include_domains).toContain('arstechnica.com');

      expect(results).toHaveLength(2);
      expect(results[0].title).toBe('Anthropic unveils Claude 3.7 Sonnet');
      expect(results[0].url).toBe('https://techcrunch.com/2026/02/anthropic-claude-3-7');
      expect(results[0].score).toBe(0.94);
    });

    it('handles network timeouts and absent API key gracefully without throwing', async () => {
      // 1. Absent key
      const noKeyResults = await searchSecondarySources('Query without key', {
        apiKey: '',
      });
      expect(noKeyResults).toEqual([]);

      // 2. Network timeout
      const mockFetchTimeout: typeof fetch = async () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      };

      const timeoutResults = await searchSecondarySources('Query with timeout', {
        apiKey: 'tvly-test-key-54321',
        fetchFn: mockFetchTimeout,
      });
      expect(timeoutResults).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Resend Newsletter Bilingual Dispatch
  // ───────────────────────────────────────────────────────────────────────────
  describe('Resend Newsletter Bilingual Dispatch', () => {
    it('batches subscribers and routes the correct template according to preferredLanguage', async () => {
      resetDbForTesting();
      await initializeDatabase();
      const db = await getDb();

      // Seed articles for digest compilation
      const [source] = await db
        .insert(schema.sources)
        .values({
          name: 'Frontier AI Lab',
          baseUrl: 'https://frontier.ai/feed.xml',
          sourceType: 'rss',
        })
        .returning();

      const [story] = await db
        .insert(schema.stories)
        .values({
          title: 'Claude 3.7 Sonnet Launches with Dynamic Thinking',
          summary: 'Anthropic releases Claude 3.7 Sonnet with hybrid reasoning.',
          category: 'llm_release',
          editorialStatus: 'published',
          riskLevel: 'low',
          importanceScore: 99,
          firstSeenAt: new Date(),
          lastUpdatedAt: new Date(),
          primarySourceId: source.id,
        })
        .returning();

      await db.insert(schema.articles).values({
        storyId: story.id,
        title: 'Claude 3.7 Sonnet Launches with Dynamic Thinking',
        titleEn: 'Claude 3.7 Sonnet Launches with Dynamic Thinking',
        titleBn: 'ক্লদ ৩.৭ সনেট হাইব্রিড রিজনিং সহ প্রকাশিত হয়েছে',
        slug: 'claude-3-7-dynamic-thinking',
        deck: 'Hybrid reasoning unifies instant responses and deep exploration.',
        contentMarkdown: 'Full article text markdown [^1].',
        metaDescription: 'Claude 3.7 Sonnet analysis.',
        status: 'published',
        publishedAt: new Date(),
      });

      // Seed subscribers with different language preferences
      const testSubscribers = [
        {
          id: '11111111-1111-1111-1111-111111111111',
          email: 'bengali-reader@example.com',
          preferredLanguage: 'bn' as const,
          topics: ['all'],
          isActive: true,
          isVerified: true,
          unsubscribedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '22222222-2222-2222-2222-222222222222',
          email: 'english-reader@example.com',
          preferredLanguage: 'en' as const,
          topics: ['all'],
          isActive: true,
          isVerified: true,
          unsubscribedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const sentEmails: Array<{
        from: string;
        to: string;
        subject: string;
        html: string;
      }> = [];

      const mockResendClient = {
        emails: {
          send: vi.fn(async (params: any) => {
            sentEmails.push(params);
            return { id: `resend_mock_${sentEmails.length}` };
          }),
        },
      };

      const newsletterService = new NewsletterService({
        resendClient: mockResendClient,
      });

      const result = await newsletterService.sendDailyDigest({
        lookbackHours: 48,
        subscribersOverride: testSubscribers,
        batchDelayMs: 0,
      });

      expect(result.success).toBe(true);
      expect(result.emailsSent).toBe(2);
      expect(result.emailsSkipped).toBe(0);
      expect(mockResendClient.emails.send).toHaveBeenCalledTimes(2);

      // Verify Bengali routing
      const bnEmail = sentEmails.find((e) => e.to === 'bengali-reader@example.com');
      expect(bnEmail).toBeDefined();
      expect(bnEmail?.subject).toContain('নক্ষত্র দৈনিক এআই ব্রিফিং');
      expect(bnEmail?.html).toContain('lang="bn"');
      expect(bnEmail?.html).toContain('নক্ষত্র (NAKSHATRA)');

      // Verify English routing
      const enEmail = sentEmails.find((e) => e.to === 'english-reader@example.com');
      expect(enEmail).toBeDefined();
      expect(enEmail?.subject).toContain('NAKSHATRA Daily');
      expect(enEmail?.html).toContain('lang="en"');
      expect(enEmail?.html).toContain('Autonomous AI Intelligence');
    });

    it('determines sender address correctly based on environment', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalFrom = process.env.NEWSLETTER_FROM_EMAIL;

      delete process.env.NEWSLETTER_FROM_EMAIL;
      process.env.NODE_ENV = 'production';
      expect(getDefaultFromEmail()).toBe('NAKSHATRA Dispatch <newsletter@nakshatra.news>');

      process.env.NODE_ENV = 'test';
      expect(getDefaultFromEmail()).toBe('NAKSHATRA Dispatch <onboarding@resend.dev>');

      process.env.NEWSLETTER_FROM_EMAIL = 'custom@nakshatra.ai';
      expect(getDefaultFromEmail()).toBe('custom@nakshatra.ai');

      process.env.NODE_ENV = originalEnv;
      process.env.NEWSLETTER_FROM_EMAIL = originalFrom;
    });
  });
});
