import 'dotenv/config';
import { startWorkerDaemon } from '../src/services/worker';

console.log('🚀 [NAKSHATRA] Autonomous Background News Polling Worker started...');

startWorkerDaemon().catch((err) => {
  console.error('[NAKSHATRA Fatal Worker Error]', err);
  process.exit(1);
});
