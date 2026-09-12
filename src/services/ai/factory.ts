import { AiModelProvider } from './provider';
import { GeminiProvider } from './gemini-provider';
import { MockAiProvider } from './mock-provider';

export function getAiProvider(apiKeyOverride?: string): AiModelProvider {
  const key = apiKeyOverride || process.env.GEMINI_API_KEY;
  if (key && key.trim().length > 0 && !key.includes('placeholder')) {
    return new GeminiProvider(key);
  }
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    throw new Error('GEMINI_API_KEY is required in production. Mock AI fallback is disabled.');
  }
  // Fallback to mock provider in test or unconfigured environments
  return new MockAiProvider();
}
