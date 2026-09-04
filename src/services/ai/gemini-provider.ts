import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { AiModelProvider, AiCallOptions, AiResponse, AiStructuredResponse } from './provider';

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

    const result = await model.generateContent(prompt);
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
    const result = await model.generateContent(structuredPrompt);
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
