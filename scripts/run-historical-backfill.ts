import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import {
  HistoricalBackfillOrchestrator,
  HistoricalBackfillReport,
} from '../src/server/backfill/historical-backfill';

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const isDryRun = args.includes('--dry-run') || !isExecute;

  let limit: number | undefined = undefined;
  const limitArg = args.find((a) => a.startsWith('--limit='));
  if (limitArg) {
    limit = parseInt(limitArg.split('=')[1], 10);
  } else {
    const limitIdx = args.indexOf('--limit');
    if (limitIdx !== -1 && args[limitIdx + 1]) {
      limit = parseInt(args[limitIdx + 1], 10);
    }
  }

  let geminiBudget: number | undefined = undefined;
  const budgetArg = args.find((a) => a.startsWith('--gemini-budget=') || a.startsWith('--budget='));
  if (budgetArg) {
    geminiBudget = parseInt(budgetArg.split('=')[1], 10);
  } else {
    const bIdx = args.indexOf('--gemini-budget') !== -1 ? args.indexOf('--gemini-budget') : args.indexOf('--budget');
    if (bIdx !== -1 && args[bIdx + 1]) {
      geminiBudget = parseInt(args[bIdx + 1], 10);
    }
  }

  let windowHours = 240; // 10 days
  const windowArgIdx = args.indexOf('--window');
  if (windowArgIdx !== -1 && args[windowArgIdx + 1]) {
    windowHours = parseInt(args[windowArgIdx + 1], 10);
  } else {
    const winArg = args.find((a) => a.startsWith('--window='));
    if (winArg) windowHours = parseInt(winArg.split('=')[1], 10);
  }

  let delayMs = 1500;
  const delayArgIdx = args.indexOf('--delay');
  if (delayArgIdx !== -1 && args[delayArgIdx + 1]) {
    delayMs = parseInt(args[delayArgIdx + 1], 10);
  } else {
    const dArg = args.find((a) => a.startsWith('--delay='));
    if (dArg) delayMs = parseInt(dArg.split('=')[1], 10);
  }

  console.log('================================================================================');
  console.log('NAKSHATRA AI NEWS — HISTORICAL CONTENT BACKFILL');
  console.log('================================================================================');
  console.log(`Execution Mode:   ${isDryRun ? 'DRY-RUN (Simulation, No Synthesis/Publishing)' : 'REAL EXECUTION (Live Synthesis & Publishing)'}`);
  console.log(`Discovery Window:  ${windowHours} hours (${Math.round(windowHours / 24)} days)`);
  console.log(`Story Cap / Limit: ${limit !== undefined ? `${limit} stories (Controlled Test Mode)` : 'UNBOUNDED (Full Quota Target)'}`);
  console.log(`Gemini Budget:     ${geminiBudget !== undefined ? `${geminiBudget} calls max` : 'UNBOUNDED'}`);
  console.log(`API Delay:         ${delayMs} ms`);
  console.log('================================================================================\n');

  const orchestrator = new HistoricalBackfillOrchestrator();

  const report: HistoricalBackfillReport = await orchestrator.run({
    dryRun: isDryRun,
    overlapHours: windowHours,
    interRequestDelayMs: delayMs,
    limit,
    geminiBudget,
    onProgress: (msg: string) => console.log(msg),
  });

  console.log('\n================================================================================');
  console.log('HISTORICAL BACKFILL FINAL SUMMARY REPORT');
  console.log('================================================================================');
  console.log(`Mode:                           ${report.isDryRun ? 'DRY-RUN' : 'REAL EXECUTION'}`);
  console.log(`Articles Before Backfill:       ${report.articlesBeforeBackfill}`);
  console.log(`Sources Scanned:                ${report.sourcesScanned}`);
  console.log(`Candidates Discovered:          ${report.candidatesDiscovered}`);
  console.log(`Duplicates Removed:             ${report.duplicatesRemoved} (${report.exactDuplicatesSkipped} exact, ${report.nearDuplicatesSkipped} near)`);
  console.log(`Raw Articles Inserted:          ${report.rawArticlesInserted}`);
  console.log(`Clusters Formed:                ${report.clustersCreated}`);
  console.log(`Stories Rejected:               ${report.storiesRejected}`);
  console.log(`Stories Held for Review:        ${report.storiesHeldForReview}`);
  console.log(`Stories Auto-Approved:          ${report.storiesAutoApproved}`);
  console.log(`Stories Selected for Synthesis: ${report.selectedForSynthesis}`);
  console.log(`Articles Synthesized:           ${report.articlesSynthesized}`);
  console.log(`Articles Published:             ${report.articlesPublished}`);
  console.log(`Final Total Articles:           ${report.articlesAfterBackfill}`);
  console.log('--------------------------------------------------------------------------------');
  console.log('Category Distribution Before vs After:');
  console.log('Category     | Before | After | Target Range | Status');
  console.log('-----------------------------------------------------');
  for (const cat of ['llm_release', 'agentic', 'infra', 'research', 'policy'] as const) {
    const before = report.categoryDistributionBefore[cat] || 0;
    const after = report.categoryDistributionAfter[cat] || 0;
    const cov = report.preSynthesisCoverage.find((c) => c.category === cat);
    const range = cov ? cov.targetRange : 'N/A';
    const status = after >= (cov?.isViable ? 5 : 0) ? 'HEALTHY' : 'PENDING';
    console.log(
      `${cat.padEnd(12)} | ${String(before).padStart(6)} | ${String(after).padStart(5)} | ${range.padStart(12)} | ${status}`
    );
  }
  console.log('================================================================================');
  console.log(`Total Runtime:                  ${((report.totalElapsedMs || 0) / 1000).toFixed(1)}s`);
  console.log(`Phase Timings Breakdown:`);
  console.log(`  - Phase 1 Baseline Audit:     <0.1s`);
  console.log(`  - Phase 2 RSS Ingestion:      ${((report.phaseTimings?.rssIngestionMs || 0) / 1000).toFixed(1)}s`);
  console.log(`  - Phase 3 Story Clustering:   ${((report.phaseTimings?.clusteringMs || 0) / 1000).toFixed(1)}s`);
  console.log(`  - Phase 4 Category Balancing: ${((report.phaseTimings?.categoryBalancingMs || 0) / 1000).toFixed(1)}s`);
  console.log(`  - Phase 5 Jina Extraction:    ${((report.phaseTimings?.jinaExtractionMs || 0) / 1000).toFixed(1)}s`);
  console.log(`  - Phase 5 Gemini Synthesis:   ${((report.phaseTimings?.geminiGenerationMs || 0) / 1000).toFixed(1)}s`);
  console.log(`  - Phase 6 DB Verification:    ${((report.phaseTimings?.verificationMs || 0) / 1000).toFixed(1)}s`);
  console.log('--------------------------------------------------------------------------------');
  console.log(`Gemini Call Budget:             ${report.geminiBudget !== undefined ? `${report.geminiBudget} calls` : 'Unbounded'}`);
  console.log(`Gemini Calls Executed:          ${report.geminiCallsUsed} calls`);
  console.log(`Budget Remaining:               ${report.budgetRemaining !== undefined ? `${report.budgetRemaining} calls` : 'N/A'}`);
  console.log(`Early Budget/Quota Exit:        ${report.stoppedEarlyDueToBudget ? 'YES (Stopped cleanly to protect quota)' : 'NO'}`);
  console.log(`Total API Calls:                Gemini: ${report.apiCalls?.geminiCount ?? report.geminiCallsUsed}, Jina: ${report.apiCalls?.jinaCount ?? 'N/A'}`);
  if (report.callsPerStory && report.callsPerStory.length > 0) {
    console.log('--------------------------------------------------------------------------------');
    console.log('Story Execution Breakdown:');
    for (const [idx, s] of report.callsPerStory.entries()) {
      console.log(`  ${idx + 1}. [${s.category}] "${s.storyTitle.slice(0, 50)}..."`);
      console.log(`     Status: ${s.status} | Jina: ${s.jinaCalls} calls (${(s.jinaMs / 1000).toFixed(1)}s) | Gemini: ${s.geminiCalls} calls (${(s.geminiMs / 1000).toFixed(1)}s)`);
    }
  }
  console.log('================================================================================');

  if (report.errors.length > 0) {
    console.log(`\nNotice: ${report.errors.length} non-fatal warning(s) occurred during backfill:`);
    for (const err of report.errors.slice(0, 5)) {
      console.log(`  - ${err}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[Fatal Backfill Error]:', err);
  process.exit(1);
});
