import { z } from 'zod';

export interface AiCallOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  modelOverride?: string;
}

export interface AiResponse {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  modelUsed: string;
}

export interface AiStructuredResponse<T> {
  data: T;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  modelUsed: string;
}

export interface AiModelProvider {
  readonly providerName: string;
  readonly defaultModel: string;

  generateText(prompt: string, options?: AiCallOptions): Promise<AiResponse>;

  generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: AiCallOptions
  ): Promise<AiStructuredResponse<T>>;
}
