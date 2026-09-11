import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { AiModelProvider, AiCallOptions, AiResponse, AiStructuredResponse } from './provider';

export class GeminiBudgetExceededError extends Error {
  constructor(public readonly budget: number, public readonly consumed: number) {
    super(`[GeminiBudgetExceededError] Configured Gemini request budget (${budget}) reached (${consumed} consumed). Stopping gracefully.`);
    this.name = 'GeminiBudgetExceededError';
  }
}

export class GeminiQuotaExhaustedError extends Error {
  constructor(public override readonly message: string, public readonly retryDelaySeconds?: number) {
    super(`[GeminiQuotaExhaustedError] Gemini free-tier quota exhausted: ${message}`);
    this.name = 'GeminiQuotaExhaustedError';
  }
}

function parseRetryDelay(errorMessage?: string): number | null {
  if (!errorMessage) return null;
  const match1 = errorMessage.match(/Please retry in ([\d.]+)s/i);
  if (match1) {
    const sec = parseFloat(match1[1]);
    if (!isNaN(sec) && sec > 0) return Math.ceil(sec * 1000);
  }
  const match2 = errorMessage.match(/"retryDelay":\s*"(\d+)s"/i);
  if (match2) {
    const sec = parseInt(match2[1], 10);
    if (!isNaN(sec) && sec > 0) return sec * 1000;
  }
  return null;
}

const DEFAULT_GEMINI_TIMEOUT_MS = 65000;

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  baseDelayMs = 1500
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: unknown) {
      attempt++;
      const err = error as { status?: number; message?: string } | undefined;
      const errorMessage = typeof err?.message === 'string' ? err.message : String(error);
      const isRateLimit =
        err?.status === 429 ||
        errorMessage.includes('429') ||
        errorMessage.includes('RESOURCE_EXHAUSTED') ||
        errorMessage.includes('quota') ||
        errorMessage.includes('Quota exceeded');

      const isRetryable =
        attempt <= maxRetries &&
        (isRateLimit ||
          err?.status === 503 ||
          err?.status === 500 ||
          err?.status === 502 ||
          err?.status === 504 ||
          errorMessage.includes('503') ||
          errorMessage.includes('500') ||
          errorMessage.includes('UNAVAILABLE') ||
          errorMessage.includes('fetch failed') ||
          errorMessage.includes('overloaded') ||
          errorMessage.includes('timed out'));

      if (!isRetryable) {
        if (isRateLimit) {
          const parsed = parseRetryDelay(errorMessage);
          throw new GeminiQuotaExhaustedError(errorMessage, parsed ? Math.round(parsed / 1000) : undefined);
        }
        throw error;
      }

      let delay: number;
      const jitter = Math.floor(Math.random() * 300);
      if (isRateLimit) {
        const parsed = parseRetryDelay(errorMessage);
        // Wait at least the suggested quota delay (bounded to max 25s) or backoff
        delay = parsed ? Math.min(25000, parsed + jitter) : Math.min(25000, baseDelayMs * Math.pow(2, attempt) + jitter);
        console.warn(`[GeminiProvider] Rate limit (429/Quota) encountered (attempt ${attempt}/${maxRetries}). Backing off ${Math.round(delay / 1000)}s before retry...`);
      } else {
        delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
        console.warn(`[GeminiProvider] Transient error on attempt ${attempt}/${maxRetries} (${errorMessage.slice(0, 100)}). Retrying in ${delay}ms...`);
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export class GeminiProvider implements AiModelProvider {
  readonly providerName = 'google_gemini';
  readonly defaultModel: string;
  private client: GoogleGenerativeAI | null = null;
  private apiKey: string;
  private requestTimeoutMs: number;
  private requestBudget: number | null = null;
  private requestsExecuted = 0;

  constructor(
    apiKey?: string,
    defaultModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    requestTimeoutMs = DEFAULT_GEMINI_TIMEOUT_MS
  ) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';
    this.defaultModel = defaultModel;
    this.requestTimeoutMs = requestTimeoutMs;
    if (this.apiKey && this.apiKey.trim() !== '') {
      this.client = new GoogleGenerativeAI(this.apiKey);
    }
  }

  setRequestBudget(budget: number | null): void {
    this.requestBudget = budget;
  }

  getRequestBudget(): number | null {
    return this.requestBudget;
  }

  getRequestsExecuted(): number {
    return this.requestsExecuted;
  }

  resetRequestCount(): void {
    this.requestsExecuted = 0;
  }

  hasBudgetRemaining(): boolean {
    if (this.requestBudget === null) return true;
    return this.requestsExecuted < this.requestBudget;
  }

  private ensureClient(): GoogleGenerativeAI {
    if (!this.client) {
      if (!this.apiKey || this.apiKey.trim() === '') {
        throw new Error('GEMINI_API_KEY is not configured. Please set GEMINI_API_KEY in your .env environment.');
      }
      this.client = new GoogleGenerativeAI(this.apiKey);
    }
    return this.client;
  }

  private async executeGenerate(
    prompt: string,
    modelName: string,
    config: Record<string, unknown>
  ) {
    if (this.requestBudget !== null && this.requestsExecuted >= this.requestBudget) {
      throw new GeminiBudgetExceededError(this.requestBudget, this.requestsExecuted);
    }

    const client = this.ensureClient();
    const timeoutMs = this.requestTimeoutMs;

    const runWithTimeout = async (targetModel: string) => {
      const model = client.getGenerativeModel(
        {
          model: targetModel,
          ...config,
        },
        { timeout: timeoutMs }
      );

      let timer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`[GeminiProvider] Request timed out after ${timeoutMs}ms for model ${targetModel}`));
        }, timeoutMs);
      });

      try {
        return await Promise.race([model.generateContent(prompt), timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    try {
      const res = await withRetry(() => runWithTimeout(modelName));
      this.requestsExecuted++;
      return res;
    } catch (err: unknown) {
      const errorObj = err as { status?: number; message?: string } | undefined;
      const errorMessage = errorObj?.message || String(err);
      // Automatic fallback if primary configured model encounters 503, 404, or 429 quota exhaustion
      const fallbackModel = 'gemini-flash-latest';
      if (
        modelName !== fallbackModel &&
        (errorObj?.status === 503 ||
          errorObj?.status === 404 ||
          errorObj?.status === 429 ||
          errorMessage.includes('503') ||
          errorMessage.includes('404') ||
          errorMessage.includes('429') ||
          errorMessage.includes('Quota exceeded') ||
          errorMessage.includes('RESOURCE_EXHAUSTED'))
      ) {
        console.warn(`[GeminiProvider] Primary model "${modelName}" unavailable (${errorMessage.slice(0, 120)}). Falling back to ${fallbackModel}.`);
        const fallbackRes = await withRetry(() => runWithTimeout(fallbackModel));
        this.requestsExecuted++;
        return fallbackRes;
      }
      throw err;
    }
  }

  async generateText(prompt: string, options?: AiCallOptions): Promise<AiResponse> {
    const modelName = options?.modelOverride || this.defaultModel;
    const result = await this.executeGenerate(prompt, modelName, {
      systemInstruction: options?.systemPrompt,
      generationConfig: {
        temperature: options?.temperature ?? 0.2,
        maxOutputTokens: options?.maxTokens ?? 4096,
      },
    });
    const text = result.response.text();
    const usage = result.response.usageMetadata;

    return {
      text,
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
      totalTokens: usage?.totalTokenCount ?? 0,
      modelUsed: modelName,
    };
  }

  async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: AiCallOptions
  ): Promise<AiStructuredResponse<T>> {
    const modelName = options?.modelOverride || this.defaultModel;
    const structuredPrompt = `${prompt}\n\nYou MUST return valid JSON adhering strictly to the expected schema without any markdown formatting or commentary.`;

    const generationConfig: Record<string, unknown> = {
      temperature: options?.temperature ?? 0.1,
      maxOutputTokens: options?.maxTokens ?? 16384,
      responseMimeType: 'application/json',
    };

    if (modelName.includes('2.5')) {
      generationConfig.thinkingConfig = {
        thinkingBudget: 0,
      };
    }

    const result = await this.executeGenerate(structuredPrompt, modelName, {
      systemInstruction: options?.systemPrompt,
      generationConfig,
    });
    const rawText = result.response.text();
    const candidate = result.response.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const usage = result.response.usageMetadata;

    let parsedJson: unknown;
    try {
      const cleanJson = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      parsedJson = JSON.parse(cleanJson);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse Gemini JSON output (finishReason: ${finishReason}, promptTokens: ${usage?.promptTokenCount}, candidatesTokens: ${usage?.candidatesTokenCount}): ${message}. Raw text: ${rawText}`);
    }

    // Resilience: if Gemini returns a raw array when an object with an array field is expected
    if (Array.isArray(parsedJson)) {
      const candidateObj = { claims: parsedJson, verdicts: parsedJson };
      const testParse = schema.safeParse(candidateObj);
      if (testParse.success) {
        parsedJson = candidateObj;
      }
    }

    const validated = schema.parse(parsedJson);

    return {
      data: validated,
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
      totalTokens: usage?.totalTokenCount ?? 0,
      modelUsed: modelName,
    };
  }
}
