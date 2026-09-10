import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { runSourceCatalogDiagnostic } from '../src/server/diagnostics/source-diagnostic';

async function main() {
  console.log('🔍 [NAKSHATRA DIAGNOSTIC] Running Live Source Catalog & Category Health Diagnostic...\n');
  const result = await runSourceCatalogDiagnostic({ syncBeforeRun: true });

  console.log('================================================================================');
  console.log('                     LIVE SOURCE CATALOG AUDIT REPORT');
  console.log('================================================================================');
  console.log(`Report Generated:             ${result.timestamp}`);
  console.log(`Active Sources Monitored:     ${result.activeSourcesCount}`);
  console.log(`Successfully Fetched Sources: ${result.successfullyFetchedCount}`);
  console.log(`Failed Sources:               ${result.failedCount}`);
  console.log(`Raw Articles Discovered:      ${result.totalArticlesDiscovered}`);
  console.log(`Unique Articles Estimated:    ${result.uniqueArticlesEstimated}`);
  console.log(`Newest Accepted Item Date:    ${result.newestContentTimestamp}`);
  console.log(`Oldest Accepted Item Date:    ${result.oldestContentTimestamp}`);
  console.log('--------------------------------------------------------------------------------\n');

  console.log('SOURCE-BY-SOURCE HEALTH:');
  for (const src of result.sourceReports) {
    const statusIcon = src.status === 'success' ? '✅' : '❌';
    console.log(
      `${statusIcon} [${src.primaryCategory.toUpperCase().padEnd(11)}] ${src.sourceName.padEnd(35)} | ` +
      `Items: ${String(src.itemsCount).padStart(4)} | ` +
      `Latency: ${String(src.latencyMs).padStart(5)}ms | ` +
      (src.newestItemDate ? `Newest: ${src.newestItemDate.toISOString().slice(0, 10)}` : `Error: ${src.error}`)
    );
  }

  console.log('\n================================================================================');
  console.log('                     CATEGORY DISTRIBUTION & HEALTH');
  console.log('================================================================================');
  for (const [cat, data] of Object.entries(result.categoryBreakdown)) {
    console.log(`\nCATEGORY: ${cat.toUpperCase()}`);
    console.log(`  Source Count:   ${data.sourceCount}`);
    console.log(`  Article Count:  ${data.articleCount}`);
    console.log('  Recent Headlines:');
    for (const h of data.sampleHeadlines) {
      console.log(`    - ${h}`);
    }
  }

  console.log('\n================================================================================');
  console.log('                     CATEGORY STARVATION VERDICTS');
  console.log('================================================================================');
  console.log(`AGENTIC CATEGORY: ${result.agenticHealthVerdict}`);
  console.log(`POLICY CATEGORY:  ${result.policyHealthVerdict}`);
  console.log('================================================================================\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('Diagnostic error:', err);
  process.exit(1);
});
