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

  private getFallbackTemplates(): any[] {
    return [
      // SynthesizedArticleDraftSchema
      {
        title: 'Autonomous AI Intelligence Breakthrough',
        deck: 'A comprehensive multi-perspective briefing on state of the art AI systems.',
        slug: `autonomous-ai-intelligence-${Date.now().toString(36)}`,
        contentMarkdown: 'Researchers have introduced breakthrough capabilities in frontier models [^1]. The development marks significant advancement in reasoning architectures.',
        metaDescription: 'Analysis of new autonomous artificial intelligence capabilities and benchmark results.',
        citations: [
          {
            citationIndex: 1,
            claimIndex: 0,
            anchorText: 'breakthrough capabilities',
            primarySourceUrl: 'https://example.com/primary-source',
            sourcePublisher: 'Research Lab',
          },
        ],
      },
      // ClaimExtractionResponseSchema
      {
        claims: [
          {
            claimText: 'Frontier AI system demonstrates state of the art reasoning performance.',
            claimType: 'benchmark',
            sourceExcerpt: 'Frontier AI system demonstrates state of the art reasoning performance.',
            confidenceScore: 0.95,
          },
        ],
      },
      // ClusterDecisionSchema
      {
        action: 'new_story',
        storyId: null,
        confidence: 0.95,
        reasoning: 'Heuristic fallback decision',
      },
      // ClusterSynthesisSchema
      {
        isSameStory: true,
        matchingArticleIndices: [0, 1],
        primaryArticleIndex: 0,
        canonicalTitle: 'Frontier AI Reasoning Breakthrough',
        summary: 'Researchers have announced a breakthrough in autonomous reasoning capabilities across multimodal benchmarks.',
        category: 'llm_release',
        riskLevel: 'low',
        importanceScore: 92,
        reasoning: 'Verified official documentation reporting new benchmark results.',
      },
      // FactVerificationResponseSchema
      {
        verificationStatus: 'verified_factual',
        confidenceScore: 0.95,
        reasoning: 'Confirmed against primary source text.',
        citationUrls: ['https://example.com/primary'],
      },
      // BilingualArticleDraftSchema
      {
        slug: `frontier-ai-breakthrough-${Date.now().toString(36)}`,
        en: {
          title: 'Frontier AI Reasoning Breakthrough',
          summary: 'A comprehensive multi-perspective briefing on state of the art AI systems.',
          content: 'Researchers have introduced breakthrough capabilities in frontier models [^1]. The development marks significant advancement in reasoning architectures.',
          keyTakeaways: [
            'Frontier AI models demonstrate breakthrough reasoning capabilities.',
            'Multi-source validation confirms verified benchmarks across lab releases.',
          ],
        },
        bn: {
          title: 'ফ্রন্টিয়ার এআই রিজনিং মডেলে যুগান্তকারী অগ্রগতি',
          summary: 'অত্যাধুনিক কৃত্রিম বুদ্ধিমত্তা ব্যবস্থার উপর একটি সমন্বিত বিশ্লেষণ প্রতিবেদন।',
          content: 'গবেষক দল ফ্রন্টিয়ার রিজনিং মডেলে (Reasoning Model) উল্লেখযোগ্য সক্ষমতা প্রদর্শন করেছেন [^1]। এই বিকাশ এআই স্থাপত্যে একটি নতুন দিগন্ত উন্মোচন করেছে।',
          keyTakeaways: [
            'ফ্রন্টিয়ার এআই রিজনিং মডেলে অভূতপূর্ব সক্ষমতা অর্জিত হয়েছে।',
            'একাধিক প্রাথমিক উৎসের তথ্যের ভিত্তিতে বেঞ্চমার্ক নিশ্চিত করা হয়েছে।',
          ],
        },
        citations: [
          {
            citationIndex: 1,
            claimIndex: 0,
            anchorText: 'breakthrough capabilities',
            primarySourceUrl: 'https://example.com/primary-source',
            sourcePublisher: 'Research Lab',
          },
        ],
      },
    ];
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
      for (const template of this.getFallbackTemplates()) {
        const testParse = schema.safeParse(template);
        if (testParse.success) {
          rawData = template;
          break;
        }
      }

      if (!rawData) {
        throw new Error('MockAiProvider has no mock responses in queue or default response set.');
      }
    }

    // Bidirectional adapter: seamlessly support both single-language and bilingual draft mocks
    if (rawData && rawData.title && rawData.contentMarkdown && !rawData.en) {
      const testBilingual = schema.safeParse({
        slug: rawData.slug || 'slug',
        en: {
          title: rawData.title,
          summary: rawData.deck || rawData.title,
          content: rawData.contentMarkdown,
          keyTakeaways: [rawData.deck || rawData.title],
        },
        bn: {
          title: rawData.title,
          summary: rawData.deck || rawData.title,
          content: rawData.contentMarkdown,
          keyTakeaways: [rawData.deck || rawData.title],
        },
        citations: rawData.citations || [],
      });
      if (testBilingual.success) {
        rawData = testBilingual.data;
      }
    } else if (rawData && rawData.en && !rawData.title) {
      const testSingle = schema.safeParse({
        title: rawData.en.title,
        deck: rawData.en.summary,
        slug: rawData.slug,
        contentMarkdown: rawData.en.content,
        metaDescription: rawData.en.summary,
        citations: rawData.citations || [],
      });
      if (testSingle.success) {
        rawData = testSingle.data;
      }
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
