import { handlePipelineCron } from '../../../../server/cron/pipeline-cron';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handlePipelineCron(req);
}

export async function POST(req: Request) {
  return handlePipelineCron(req);
}
