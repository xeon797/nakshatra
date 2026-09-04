import { NextResponse } from 'next/server';
import { getDb } from '../../../../db';
import * as schema from '../../../../db/schema';
import { eq } from 'drizzle-orm';
import { AutonomousNewsroomOrchestrator } from '../../../../services/orchestrator';
import { initializeDatabase } from '../../../../db/init';
import { seedDefaultSources } from '../../../../services/ingestion/seed-sources';

export async function POST() {
  try {
    await initializeDatabase();
    await seedDefaultSources();
    const db = await getDb();

    const activeSources = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.isActive, true));

    const orchestrator = new AutonomousNewsroomOrchestrator();
    const reports = [];

    for (const source of activeSources) {
      try {
        const report = await orchestrator.processSource(source.id);
        reports.push(report);
      } catch (err: any) {
        reports.push({
          sourceName: source.name,
          articlesIngested: 0,
          draftsGenerated: 0,
          failures: [err.message || String(err)],
          articleIds: [],
        });
      }
    }

    return NextResponse.json({ success: true, reports });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Pipeline execution failed' },
      { status: 500 }
    );
  }
}
