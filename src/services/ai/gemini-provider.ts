import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import {
  AiModelProvider,
  AiCallOptions,
  AiResponse,
  AiStructuredResponse,
  AiExecutionPolicy,
} from './provider';

export class GeminiBudgetExceededError extends Error {
  constructor(public readonly budget: number, public readonly consumed: number) {
    super(`[GeminiBudgetExceededError] Configured Gemini request budget (${budget}) reached (${consumed} consumed). Stopping gracefully.`);
    this.name = 'GeminiBudgetExceededError';
  }
}

export class GeminiQuotaExhaustedError extends Error {
  constructor(message: string, public readonly retryDelaySeconds?: number) {
    super(`[GeminiQuotaExhaustedError] Gemini free-tier quota exhausted: ${message}`);
    this.name = 'GeminiQuotaExhaustedError';
  }
}

export class GeminiServiceUnavailableError extends Error {
  constructor(message: string) {
    super(`[GeminiServiceUnavailableError] Gemini service unavailable: ${message}`);
    this.name = 'GeminiServiceUnavailableError';
  }
}

export class GeminiDeadlineExceededError extends Error {
  constructor(message: string) {
    super(`[GeminiDeadlineExceededError] ${message}`);
    this.name = 'GeminiDeadlineExceededError';
  }
}

export function isGeminiControlFlowError(error: unknown): boolean {
  return (
    error instanceof GeminiBudgetExceededError ||
    error instanceof GeminiQuotaExhaustedError ||
    error instanceof GeminiServiceUnavailableError ||
    error instanceof GeminiDeadlineExceededError
  );
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

const DEFAULT_GEMINI_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 1;
const RETRY_BASE_DELAY_MS = 1_000;

function getErrorDetails(error: unknown): { status?: number; message: string } {
  const candidate = error as { status?: number; message?: string } | undefined;
  return {
    status: candidate?.status,
    message: typeof candidate?.message === 'string' ? candidate.message : String(error),
  };
}

function isQuotaError(error: unknown): boolean {
  const { status, message } = getErrorDetails(error);
  return (
    status === 429 ||
    message.includes('429') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.toLowerCase().includes('quota') ||
    message.toLowerCase().includes('rate limit')
  );
}

function isTransientServiceError(error: unknown): boolean {
  const { status, message } = getErrorDetails(error);
  const lower = message.toLowerCase();
  return (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('504') ||
    lower.includes('unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('fetch failed') ||
    lower.includes('timed out')
  );
}

export class GeminiProvider implements AiModelProvider {
  readonly providerName = 'google_gemini';
  readonly defaultModel: string;
  private client: GoogleGenerativeAI | null = null;
  private apiKey: string;
  private requestTimeoutMs: number;
  private attemptBudget: number | null = null;
  private attemptsExecuted = 0;
  private maxRetries = DEFAULT_MAX_RETRIES;
  private deadlineAt: number | null = null;
  private shutdownHeadroomMs = 0;
  private allowModelFallback = true;

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
    this.attemptBudget = budget;
  }

  getRequestBudget(): number | null {
    return this.attemptBudget;
  }

  getRequestsExecuted(): number {
    return this.attemptsExecuted;
  }

  getAttemptsExecuted(): number {
    return this.attemptsExecuted;
  }

  resetRequestCount(): void {
    this.attemptsExecuted = 0;
  }

  hasBudgetRemaining(): boolean {
    if (this.attemptBudget === null) return true;
    return this.attemptsExecuted < this.attemptBudget;
  }

  configureExecutionPolicy(policy: AiExecutionPolicy): void {
    if (policy.attemptBudget !== undefined) this.attemptBudget = policy.attemptBudget;
    if (policy.maxRetries !== undefined) this.maxRetries = Math.max(0, policy.maxRetries);
    if (policy.requestTimeoutMs !== undefined) {
      this.requestTimeoutMs = Math.max(1, policy.requestTimeoutMs);
    }
    if (policy.deadlineAt !== undefined) this.deadlineAt = policy.deadlineAt;
    if (policy.shutdownHeadroomMs !== undefined) {
      this.shutdownHeadroomMs = Math.max(0, policy.shutdownHeadroomMs);
    }
    if (policy.allowModelFallback !== undefined) {
      this.allowModelFallback = policy.allowModelFallback;
    }
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

  private resolveAttemptTimeoutMs(): number {
    if (this.deadlineAt === null) return this.requestTimeoutMs;
    const remaining = this.deadlineAt - Date.now() - this.shutdownHeadroomMs;
    if (remaining <= 0) {
      throw new GeminiDeadlineExceededError('No runtime remains for another outbound attempt.');
    }
    return Math.max(1, Math.min(this.requestTimeoutMs, remaining));
  }

  private consumeAttempt(): void {
    if (this.attemptBudget !== null && this.attemptsExecuted >= this.attemptBudget) {
      throw new GeminiBudgetExceededError(this.attemptBudget, this.attemptsExecuted);
    }
    this.attemptsExecuted++;
  }

  private normalizeProviderError(error: unknown): Error {
    if (
      error instanceof GeminiBudgetExceededError ||
      error instanceof GeminiQuotaExhaustedError ||
      error instanceof GeminiServiceUnavailableError ||
      error instanceof GeminiDeadlineExceededError
    ) {
      return error;
    }
    const { message } = getErrorDetails(error);
    if (isQuotaError(error)) {
      const parsed = parseRetryDelay(message);
      return new GeminiQuotaExhaustedError(
        message,
        parsed ? Math.round(parsed / 1000) : undefined
      );
    }
    if (isTransientServiceError(error)) {
      return new GeminiServiceUnavailableError(message);
    }
    return error instanceof Error ? error : new Error(message);
  }

  private canWaitForRetry(delayMs: number): boolean {
    if (!this.hasBudgetRemaining()) return false;
    if (this.deadlineAt === null) return true;
    return Date.now() + delayMs + this.requestTimeoutMs + this.shutdownHeadroomMs < this.deadlineAt;
  }

  private async runSingleAttempt(
    prompt: string,
    modelName: string,
    config: Record<string, unknown>
  ) {
    const client = this.ensureClient();
    const timeoutMs = this.resolveAttemptTimeoutMs();
    this.consumeAttempt();
    const model = client.getGenerativeModel(
      {
        model: modelName,
        ...config,
      },
      { timeout: timeoutMs }
    );
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new GeminiServiceUnavailableError(
          `Request timed out after ${timeoutMs}ms for model ${modelName}`
        ));
      }, timeoutMs);
    });
    try {
      return await Promise.race([model.generateContent(prompt), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async runModelWithRetries(
    prompt: string,
    modelName: string,
    config: Record<string, unknown>
  ) {
    let retriesUsed = 0;
    while (true) {
      try {
        return await this.runSingleAttempt(prompt, modelName, config);
      } catch (error) {
        const normalized = this.normalizeProviderError(error);
        if (normalized instanceof GeminiQuotaExhaustedError) {
          throw normalized;
        }
        const retryable = normalized instanceof GeminiServiceUnavailableError;
        if (!retryable || retriesUsed >= this.maxRetries) {
          throw normalized;
        }
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, retriesUsed) + Math.floor(Math.random() * 250);
        if (!this.canWaitForRetry(delayMs)) {
          throw normalized;
        }
        retriesUsed++;
        console.warn(
          `[GeminiProvider] Transient service failure; retrying attempt ${retriesUsed}/${this.maxRetries} in ${delayMs}ms.`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  private async executeGenerate(
    prompt: string,
    modelName: string,
    config: Record<string, unknown>
  ) {
    try {
      const result = await this.runModelWithRetries(prompt, modelName, config);
      return { result, modelUsed: modelName };
    } catch (error) {
      const normalized = this.normalizeProviderError(error);
      const fallbackModel = 'gemini-flash-latest';
      const { status, message } = getErrorDetails(error);
      const fallbackEligible =
        status === 404 ||
        message.includes('404') ||
        normalized instanceof GeminiServiceUnavailableError;
      if (
        this.allowModelFallback &&
        fallbackEligible &&
        !(normalized instanceof GeminiQuotaExhaustedError) &&
        modelName !== fallbackModel &&
        this.hasBudgetRemaining()
      ) {
        console.warn(`[GeminiProvider] Falling back from "${modelName}" to "${fallbackModel}".`);
        const result = await this.runModelWithRetries(prompt, fallbackModel, config);
        return { result, modelUsed: fallbackModel };
      }
      throw normalized;
    }
  }

  async generateText(prompt: string, options?: AiCallOptions): Promise<AiResponse> {
    const modelName = options?.modelOverride || this.defaultModel;
    const execution = await this.executeGenerate(prompt, modelName, {
      systemInstruction: options?.systemPrompt,
      generationConfig: {
        temperature: options?.temperature ?? 0.2,
        maxOutputTokens: options?.maxTokens ?? 4096,
      },
    });
    const text = execution.result.response.text();
    const usage = execution.result.response.usageMetadata;

    return {
      text,
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
      totalTokens: usage?.totalTokenCount ?? 0,
      modelUsed: execution.modelUsed,
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

    const execution = await this.executeGenerate(structuredPrompt, modelName, {
      systemInstruction: options?.systemPrompt,
      generationConfig,
    });
    const rawText = execution.result.response.text();
    const candidate = execution.result.response.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const usage = execution.result.response.usageMetadata;

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
      modelUsed: execution.modelUsed,
    };
  }
}
