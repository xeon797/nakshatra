import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: sdk.generateContent };
    }
  },
}));

import {
  GeminiProvider,
  GeminiQuotaExhaustedError,
  GeminiServiceUnavailableError,
} from '../gemini-provider';

describe('Gemini outbound attempt budget', () => {
  beforeEach(() => {
    sdk.generateContent.mockReset();
  });

  it('counts a failed 503 as the single allowed outbound attempt and does not retry', async () => {
    sdk.generateContent.mockRejectedValue(Object.assign(new Error('503 Service Unavailable'), { status: 503 }));
    const provider = new GeminiProvider('test-key', 'gemini-test');
    provider.configureExecutionPolicy({
      attemptBudget: 1,
      maxRetries: 0,
      allowModelFallback: false,
      requestTimeoutMs: 1000,
    });

    await expect(provider.generateText('test')).rejects.toBeInstanceOf(GeminiServiceUnavailableError);
    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
    expect(provider.getAttemptsExecuted()).toBe(1);
  });

  it('never retries a 429 even when normal transient retries are enabled', async () => {
    sdk.generateContent.mockRejectedValue(Object.assign(new Error('429 RESOURCE_EXHAUSTED'), { status: 429 }));
    const provider = new GeminiProvider('test-key', 'gemini-test');
    provider.configureExecutionPolicy({
      attemptBudget: 3,
      maxRetries: 2,
      allowModelFallback: true,
      requestTimeoutMs: 1000,
    });

    await expect(provider.generateText('test')).rejects.toBeInstanceOf(GeminiQuotaExhaustedError);
    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
    expect(provider.getAttemptsExecuted()).toBe(1);
  });

  it('counts each normal-mode 503 retry against the same attempt budget', async () => {
    sdk.generateContent.mockRejectedValue(Object.assign(new Error('503 Service Unavailable'), { status: 503 }));
    const provider = new GeminiProvider('test-key', 'gemini-flash-latest');
    provider.configureExecutionPolicy({
      attemptBudget: 2,
      maxRetries: 1,
      allowModelFallback: false,
      requestTimeoutMs: 1000,
    });

    await expect(provider.generateText('test')).rejects.toBeInstanceOf(GeminiServiceUnavailableError);
    expect(sdk.generateContent).toHaveBeenCalledTimes(2);
    expect(provider.getAttemptsExecuted()).toBe(2);
  });
});
