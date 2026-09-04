import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { AiModelProvider, AiCallOptions, AiResponse, AiStructuredResponse } from './provider';

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      const isRetryable =
        attempt <= maxRetries &&
        (error?.status === 429 ||
          error?.status === 503 ||
          error?.status === 500 ||
          error?.status === 502 ||
          error?.status === 504 ||
          (typeof error?.message === 'string' &&
            (error.message.includes('429') ||
              error.message.includes('503') ||
              error.message.includes('500') ||
              error.message.includes('RESOURCE_EXHAUSTED') ||
              error.message.includes('UNAVAILABLE') ||
              error.message.includes('fetch failed') ||
              error.message.includes('overloaded'))));

      if (!isRetryable) {
        throw error;
      }

      const jitter = Math.floor(Math.random() * 200);
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export class GeminiProvider implements AiModelProvider {
  readonly providerName = 'google_gemini';
  readonly defaultModel: string;
  private client: GoogleGenerativeAI | null = null;
  private apiKey: string;

  constructor(apiKey?: string, defaultModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash') {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';
    this.defaultModel = defaultModel;
    if (this.apiKey && this.apiKey.trim() !== '') {
      this.client = new GoogleGenerativeAI(this.apiKey);
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

  async generateText(prompt: string, options?: AiCallOptions): Promise<AiResponse> {
    const client = this.ensureClient();
    const modelName = options?.modelOverride || this.defaultModel;
    const model = client.getGenerativeModel({
      model: modelName,
      systemInstruction: options?.systemPrompt,
      generationConfig: {
        temperature: options?.temperature ?? 0.2,
        maxOutputTokens: options?.maxTokens ?? 2048,
      },
    });

    const result = await withRetry(() => model.generateContent(prompt));
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
    const client = this.ensureClient();
    const modelName = options?.modelOverride || this.defaultModel;
    const model = client.getGenerativeModel({
      model: modelName,
      systemInstruction: options?.systemPrompt,
      generationConfig: {
        temperature: options?.temperature ?? 0.1,
        maxOutputTokens: options?.maxTokens ?? 4096,
        responseMimeType: 'application/json',
      },
    });

    const structuredPrompt = `${prompt}\n\nYou MUST return valid JSON adhering strictly to the expected schema without any markdown formatting or commentary.`;
    const result = await withRetry(() => model.generateContent(structuredPrompt));
    const rawText = result.response.text();
    const usage = result.response.usageMetadata;

    let parsedJson: any;
    try {
      const cleanJson = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      parsedJson = JSON.parse(cleanJson);
    } catch (err: any) {
      throw new Error(`Failed to parse Gemini JSON output: ${err.message}. Raw text: ${rawText}`);
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
