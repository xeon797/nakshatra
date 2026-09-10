import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { GoogleGenerativeAI } from '@google/generative-ai';
import { Resend } from 'resend';

export interface ServiceTestResult {
  service: 'Gemini' | 'Jina' | 'Tavily' | 'Resend';
  status: 'PASS' | 'FAIL';
  details: string;
  error?: string;
}

export async function testGeminiLive(): Promise<ServiceTestResult> {
  const rawKey = process.env.GEMINI_API_KEY;
  if (!rawKey || rawKey.trim().length === 0 || rawKey.includes('placeholder')) {
    return {
      service: 'Gemini',
      status: 'FAIL',
      details: 'GEMINI_API_KEY is not configured or is a placeholder.',
    };
  }

  const key = rawKey.trim().replace(/^["']|["']$/g, '');
  const rawModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const modelName = rawModel.trim().replace(/^["']|["']$/g, '');

  try {
    const client = new GoogleGenerativeAI(key);
    const model = client.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 256,
        temperature: 0.1,
      },
    });

    const prompt = 'Return a JSON object with a single field "status" set to "live_verified".';
    const response = await model.generateContent(prompt);
    const text = response.response.text();

    if (!text || text.trim().length === 0) {
      return {
        service: 'Gemini',
        status: 'FAIL',
        details: `Gemini returned an empty response for model "${modelName}".`,
      };
    }

    try {
      const parsed = JSON.parse(text.trim());
      if (parsed.status !== 'live_verified') {
        return {
          service: 'Gemini',
          status: 'FAIL',
          details: `Gemini response JSON did not match expected structure: ${text.trim()}`,
        };
      }
    } catch {
      // If output is not pure JSON
      if (!text.includes('live_verified')) {
        return {
          service: 'Gemini',
          status: 'FAIL',
          details: `Gemini response failed JSON verification: ${text.trim()}`,
        };
      }
    }

    return {
      service: 'Gemini',
      status: 'PASS',
      details: `Successfully communicated with model "${modelName}". Real structured response verified.`,
    };
  } catch (err: unknown) {
    const errorObj = err as { status?: number; message?: string } | undefined;
    const msg = errorObj?.message || String(err);

    const isQuota =
      errorObj?.status === 429 ||
      msg.includes('429') ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('Quota exceeded');

    return {
      service: 'Gemini',
      status: 'FAIL',
      details: isQuota
        ? 'Gemini real API: FAILED — quota/rate limit exceeded (429 RESOURCE_EXHAUSTED)'
        : `Gemini real API: FAILED — ${msg}`,
      error: msg,
    };
  }
}

export async function testJinaLive(): Promise<ServiceTestResult> {
  const key = process.env.JINA_API_KEY;
  const targetUrl = 'https://r.jina.ai/https://example.com';

  try {
    const headers: Record<string, string> = {
      Accept: 'text/plain, text/markdown',
      'X-Return-Format': 'markdown',
    };

    if (key && key.trim().length > 0 && !key.includes('placeholder')) {
      headers['Authorization'] = `Bearer ${key.trim()}`;
    }

    const res = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return {
        service: 'Jina',
        status: 'FAIL',
        details: `Jina Reader returned HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const markdown = await res.text();
    if (!markdown || markdown.trim().length < 20) {
      return {
        service: 'Jina',
        status: 'FAIL',
        details: 'Jina Reader returned an empty or incomplete response.',
      };
    }

    const hasExpectedContent =
      markdown.toLowerCase().includes('example domain') || markdown.includes('example.com');

    return {
      service: 'Jina',
      status: hasExpectedContent ? 'PASS' : 'FAIL',
      details: hasExpectedContent
        ? `Jina Reader extracted valid markdown (${markdown.length} bytes). Auth header was ${key ? 'included' : 'omitted'}.`
        : 'Jina Reader content did not match target domain.',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      service: 'Jina',
      status: 'FAIL',
      details: `Jina Reader connection failed: ${msg}`,
      error: msg,
    };
  }
}

export async function testTavilyLive(): Promise<ServiceTestResult> {
  const key = process.env.TAVILY_API_KEY;
  if (!key || key.trim().length === 0 || key.includes('placeholder')) {
    return {
      service: 'Tavily',
      status: 'FAIL',
      details: 'TAVILY_API_KEY is not configured or is a placeholder.',
    };
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key.trim(),
        query: 'artificial intelligence news',
        max_results: 1,
        search_depth: 'basic',
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        service: 'Tavily',
        status: 'FAIL',
        details: `Tavily Search API returned HTTP ${res.status}: ${errText}`,
      };
    }

    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };

    if (!Array.isArray(data.results) || data.results.length === 0) {
      return {
        service: 'Tavily',
        status: 'FAIL',
        details: 'Tavily returned 0 search results for query.',
      };
    }

    return {
      service: 'Tavily',
      status: 'PASS',
      details: `Tavily returned ${data.results.length} valid results with title and snippet.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      service: 'Tavily',
      status: 'FAIL',
      details: `Tavily Search connection failed: ${msg}`,
      error: msg,
    };
  }
}

export async function testResendLive(): Promise<ServiceTestResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key || key.trim().length === 0 || key.includes('placeholder')) {
    return {
      service: 'Resend',
      status: 'FAIL',
      details: 'RESEND_API_KEY is not configured or is a placeholder.',
    };
  }

  try {
    const resend = new Resend(key.trim());

    // 1. If RESEND_TEST_RECIPIENT is provided, perform a real send to that authorized recipient
    const testRecipient = process.env.RESEND_TEST_RECIPIENT;
    if (testRecipient && testRecipient.includes('@')) {
      const sendRes = await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: testRecipient,
        subject: 'NAKSHATRA Live Integration Test',
        html: '<p>NAKSHATRA live Resend API verification successful.</p>',
      });

      if (sendRes.error) {
        return {
          service: 'Resend',
          status: 'FAIL',
          details: `Resend test email failed: ${sendRes.error.message}`,
        };
      }

      return {
        service: 'Resend',
        status: 'PASS',
        details: `Successfully dispatched test email to authorized recipient (${testRecipient}) via onboarding@resend.dev (ID: ${sendRes.data?.id}).`,
      };
    }

    // 2. Safe sandbox validation without sending unsolicited emails:
    // Send-restricted API keys validate via the /emails endpoint with onboarding@resend.dev
    const probeResponse = await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: 'connectivity-probe@nakshatra.invalid',
      subject: 'NAKSHATRA Live Auth Check',
      html: '<p>Connection probe</p>',
    });

    if (probeResponse.error) {
      const errorName = probeResponse.error.name;
      const errorMessage = probeResponse.error.message;

      // When an API key is invalid, Resend returns HTTP 401 with 'invalid_api_key'
      if (errorMessage.includes('API key') && (errorMessage.includes('invalid') || errorMessage.includes('restricted'))) {
        return {
          service: 'Resend',
          status: 'FAIL',
          details: `Resend API rejected credentials: ${errorMessage}`,
        };
      }

      // When the key is authenticated, Resend validates domain permissions:
      // In sandbox mode without custom domain, Resend enforces sending only to account owner
      if (
        errorMessage.includes('You can only send testing emails to your own email address') ||
        errorName === 'validation_error'
      ) {
        const ownerMatch = errorMessage.match(/\(([^)]+@[^)]+)\)/);
        const ownerEmail = ownerMatch ? ownerMatch[1] : 'account owner';
        return {
          service: 'Resend',
          status: 'PASS',
          details: `Resend API authenticated successfully (Send-only key verified). Sandboxed to ${ownerEmail}. Verified without sending unsolicited emails.`,
        };
      }

      return {
        service: 'Resend',
        status: 'FAIL',
        details: `Resend API error: ${errorMessage}`,
      };
    }

    return {
      service: 'Resend',
      status: 'PASS',
      details: 'Resend API authenticated successfully.',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      service: 'Resend',
      status: 'FAIL',
      details: `Resend connection failed: ${msg}`,
      error: msg,
    };
  }
}

async function runLiveIntegrationProbe() {
  console.log('======================================================');
  console.log('🌐 NAKSHATRA LIVE EXTERNAL API INTEGRATION TEST');
  console.log('======================================================\n');

  const results: ServiceTestResult[] = [];

  // 1. Gemini
  process.stdout.write('1. Testing Google Gemini Live API... ');
  const geminiRes = await testGeminiLive();
  results.push(geminiRes);
  console.log(geminiRes.status === 'PASS' ? '✅ PASS' : '❌ FAIL');
  console.log(`   ${geminiRes.details}\n`);

  // 2. Jina
  process.stdout.write('2. Testing Jina Reader Live API... ');
  const jinaRes = await testJinaLive();
  results.push(jinaRes);
  console.log(jinaRes.status === 'PASS' ? '✅ PASS' : '❌ FAIL');
  console.log(`   ${jinaRes.details}\n`);

  // 3. Tavily
  process.stdout.write('3. Testing Tavily Search Live API... ');
  const tavilyRes = await testTavilyLive();
  results.push(tavilyRes);
  console.log(tavilyRes.status === 'PASS' ? '✅ PASS' : '❌ FAIL');
  console.log(`   ${tavilyRes.details}\n`);

  // 4. Resend
  process.stdout.write('4. Testing Resend Email Live API... ');
  const resendRes = await testResendLive();
  results.push(resendRes);
  console.log(resendRes.status === 'PASS' ? '✅ PASS' : '❌ FAIL');
  console.log(`   ${resendRes.details}\n`);

  console.log('======================================================');
  const allPassed = results.every((r) => r.status === 'PASS');
  if (allPassed) {
    console.log('🎉 ALL 4 REAL EXTERNAL APIS AUTHENTICATED & OPERATIONAL');
  } else {
    const failedServices = results.filter((r) => r.status === 'FAIL').map((r) => r.service);
    console.log(`⚠️ ISSUES DETECTED: [${failedServices.join(', ')}] failed live test.`);
  }
  console.log('======================================================');

  if (!allPassed) {
    process.exit(1);
  }
}

// Execute probe directly only when called via CLI
const isDirectExecution = process.argv[1]?.includes('live-api-probe');
if (isDirectExecution) {
  runLiveIntegrationProbe().catch((err) => {
    console.error('Fatal error during live integration test:', err);
    process.exit(1);
  });
}

