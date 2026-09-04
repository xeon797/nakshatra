import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabaseInitialized } from '../../../../db/init';
import { NewsletterService, SubscribeSchema } from '../../../../server/services/newsletter-service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();

    const body = await request.json();
    const parseResult = SubscribeSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: parseResult.error.errors[0]?.message || 'Invalid subscription payload',
        },
        { status: 400 }
      );
    }

    const newsletterService = new NewsletterService();
    const result = await newsletterService.subscribe(parseResult.data);

    return NextResponse.json({
      success: true,
      message: result.isNew
        ? 'Successfully subscribed to NAKSHATRA AI Intelligence briefings.'
        : 'Subscription preferences updated successfully.',
      email: result.subscriber.email,
      topics: result.subscriber.topics,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: err.errors[0]?.message || 'Validation error' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error while subscribing' },
      { status: 500 }
    );
  }
}
