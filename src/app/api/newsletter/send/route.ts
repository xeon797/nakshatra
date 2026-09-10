import { handleNewsletterCron } from '../../../../server/cron/newsletter-cron';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handleNewsletterCron(req);
}

export async function POST(req: Request) {
  return handleNewsletterCron(req);
}
