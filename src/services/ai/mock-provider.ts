import { z } from 'zod';
import { AiModelProvider, AiCallOptions, AiResponse, AiStructuredResponse } from './provider';

export class MockAiProvider implements AiModelProvider {
  readonly providerName = 'mock_ai';
  readonly defaultModel = 'mock-gemini-2.5';
  private mockStructuredQueue: any[] = [];
  private mockStructuredResponse: any = null;
  private mockTextResponse: string = 'Mock response';

  constructor(options?: { mockStructured?: any; mockText?: string }) {
    if (options?.mockStructured) this.mockStructuredResponse = options.mockStructured;
    if (options?.mockText) this.mockTextResponse = options.mockText;
  }

  enqueueStructuredResponse(data: any) {
    this.mockStructuredQueue.push(data);
  }

  setMockStructuredResponse(data: any) {
    this.mockStructuredResponse = data;
  }

  setMockTextResponse(text: string) {
    this.mockTextResponse = text;
  }

  async generateText(prompt: string, options?: AiCallOptions): Promise<AiResponse> {
    return {
      text: this.mockTextResponse,
      promptTokens: Math.ceil(prompt.length / 4),
      completionTokens: Math.ceil(this.mockTextResponse.length / 4),
      totalTokens: Math.ceil((prompt.length + this.mockTextResponse.length) / 4),
      modelUsed: options?.modelOverride || this.defaultModel,
    };
  }

  async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: AiCallOptions
  ): Promise<AiStructuredResponse<T>> {
    let rawData: any;
    if (this.mockStructuredQueue.length > 0) {
      rawData = this.mockStructuredQueue.shift();
    } else if (this.mockStructuredResponse) {
      rawData = this.mockStructuredResponse;
    } else {
      throw new Error('MockAiProvider has no mock responses in queue or default response set.');
    }

    const validated = schema.parse(rawData);
    return {
      data: validated,
      promptTokens: Math.ceil(prompt.length / 4),
      completionTokens: 150,
      totalTokens: Math.ceil(prompt.length / 4) + 150,
      modelUsed: options?.modelOverride || this.defaultModel,
    };
  }
}
