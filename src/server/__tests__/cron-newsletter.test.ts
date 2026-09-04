import { describe, it, expect, beforeEach } from 'vitest';
import { handleNewsletterCron } from '../cron/newsletter-cron';
import { getDb, resetDbForTesting } from '../../db';
import * as schema from '../../db/schema';
import { ensureDatabaseInitialized } from '../../db/init';
import { eq } from 'drizzle-orm';

describe('Newsletter Automated Dispatch Cron (/api/cron/newsletter)', () => {
  const CRON_SECRET = 'test-cron-secret-newsletter-2026';

  beforeEach(async () => {
    process.env.CRON_SECRET = CRON_SECRET;
    resetDbForTesting();
    await ensureDatabaseInitialized();
  });

  it('rejects unauthenticated requests with 401 Unauthorized', async () => {
    const req = new Request('http://localhost:3000/api/cron/newsletter', {
      method: 'GET',
    });

    const res = await handleNewsletterCron(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects requests with invalid secret token', async () => {
    const req = new Request('http://localhost:3000/api/cron/newsletter', {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-secret',
      },
    });

    const res = await handleNewsletterCron(req);
    expect(res.status).toBe(401);
  });

  it('dispatches daily digest, batches subscribers, and records campaign metrics', async () => {
    const db = await getDb();

    // 1. Seed active subscribers
    await db.insert(schema.subscribers).values([
      {
        email: 'reader1@example.com',
        topics: ['all'],
        preferredLanguage: 'bn',
        isActive: true,
      },
      {
        email: 'reader2@example.com',
        topics: ['all'],
        preferredLanguage: 'en',
        isActive: true,
      },
      {
        email: 'inactive@example.com',
        topics: ['all'],
        preferredLanguage: 'bn',
        isActive: false, // Inactive, should not be included
      },
    ]);

    // 2. Dispatch cron request
    const req = new Request('http://localhost:3000/api/cron/newsletter', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
      },
    });

    const res = await handleNewsletterCron(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.recipientsCount).toBe(2);
    expect(body.emailsSent).toBe(2);
    expect(body.campaignId).toBeDefined();

    // 3. Verify newsletter_campaigns database record
    const [campaign] = await db
      .select()
      .from(schema.newsletterCampaigns)
      .where(eq(schema.newsletterCampaigns.id, body.campaignId));

    expect(campaign).toBeDefined();
    expect(campaign.sentCount).toBe(2);
    expect(campaign.recipientsCount).toBe(2);
    expect(campaign.subjectEn).toContain('NAKSHATRA Daily');
    expect(campaign.subjectBn).toContain('নক্ষত্র দৈনিক এআই ব্রিফিং');
    expect(campaign.sentAt).toBeDefined();
  });

  it('authenticates successfully via ?secret= query parameter', async () => {
    const req = new Request(`http://localhost:3000/api/cron/newsletter?secret=${CRON_SECRET}`, {
      method: 'GET',
    });

    const res = await handleNewsletterCron(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
