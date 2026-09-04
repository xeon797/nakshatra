import { NextResponse } from 'next/server';
import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { ensureDatabaseInitialized } from '../../db/init';
import { verifyCronSecret } from '../../lib/auth';
import { NewsletterService } from '../services/newsletter-service';
import { eq } from 'drizzle-orm';

export async function handleNewsletterCron(req: Request, serviceInstance?: NewsletterService) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureDatabaseInitialized();
  const db = await getDb();
  const newsletterService = serviceInstance || new NewsletterService();

  const activeSubscribers = await db
    .select()
    .from(schema.subscribers)
    .where(eq(schema.subscribers.isActive, true));

  const digestPayload = await newsletterService.compileDigestPayload(24);
  const subjectEn = `NAKSHATRA Daily: ${digestPayload.topStory?.titleEn || digestPayload.topStory?.title || 'Frontier AI Intelligence Briefing'}`;
  const subjectBn = `নক্ষত্র দৈনিক এআই ব্রিফিং: ${digestPayload.topStory?.titleBn || digestPayload.topStory?.title || 'ফ্রন্টিয়ার এআই ইন্টেলিজেন্স'}`;

  const CHUNK_SIZE = 50;
  let totalSent = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  const allErrors: string[] = [];

  if (activeSubscribers.length > 0) {
    for (let i = 0; i < activeSubscribers.length; i += CHUNK_SIZE) {
      const batch = activeSubscribers.slice(i, i + CHUNK_SIZE);
      const batchResult = await newsletterService.sendDailyDigest({
        lookbackHours: 24,
        subscribersOverride: batch,
      });

      totalSent += batchResult.emailsSent;
      totalSkipped += batchResult.emailsSkipped;
      if (batchResult.errors.length > 0) {
        totalFailed += batchResult.errors.length;
        allErrors.push(...batchResult.errors);
      }
    }
  }

  const [campaign] = await db
    .insert(schema.newsletterCampaigns)
    .values({
      subjectEn,
      subjectBn,
      sentCount: totalSent,
      skippedCount: totalSkipped,
      failedCount: totalFailed,
      recipientsCount: activeSubscribers.length,
      errorLog: allErrors.length > 0 ? allErrors.slice(0, 10).join('; ') : null,
      sentAt: new Date(),
    })
    .returning();

  return NextResponse.json({
    success: true,
    campaignId: campaign.id,
    emailsSent: totalSent,
    emailsSkipped: totalSkipped,
    failedCount: totalFailed,
    recipientsCount: activeSubscribers.length,
    errors: allErrors,
  });
}
