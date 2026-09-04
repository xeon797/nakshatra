import { HIGH_SIGNAL_AI_SOURCES, seedSources } from '../../server/db/seeds/sources';

export const DEFAULT_AI_SOURCES = HIGH_SIGNAL_AI_SOURCES;

export async function seedDefaultSources(): Promise<void> {
  await seedSources();
}

