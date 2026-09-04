import 'dotenv/config';
import { startPhase2Daemon } from '../src/server/worker';

console.log('🚀 [NAKSHATRA] Autonomous Background News Polling & Clustering Worker (Phase 2) started...');

startPhase2Daemon().catch((err) => {
  console.error('[NAKSHATRA Fatal Worker Error]', err);
  process.exit(1);
});
