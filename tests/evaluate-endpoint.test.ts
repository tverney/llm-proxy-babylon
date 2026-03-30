import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProxyServer, type ProxyServerConfig } from '../src/pipeline/proxy-server.ts';
import type { ModelProfile, RoutingPolicy, TranslatorConfig } from '../src/models/config.ts';

// Mock fetch globally so LLM forwarder and translator don't make real HTTP calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeLLMResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  };
}

function makeTranslateResponse(translatedText: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ translatedText }),
  };
}

function buildConfig(): ProxyServerConfig {
  const modelProfiles: ModelProfile[] = [
    {
      modelId: 'test-model',
      supportedLanguages: ['en', 'fr', 'de'],
      languagePerformance: [
        { languageTag: 'en', performanceRating: 1.0 },
        { languageTag: 'fr', performanceRating: 0.9 },
      ],
      defaultOptimalLanguage: 'en',
      endpoint: 'http://localhost:9999/v1/chat/completions',
    },
  ];
  const routingPolicy: RoutingPolicy = { rules: [] };
  const translatorConfig: TranslatorConfig = {
    backend: 'libretranslate',
    endpoint: 'http://localhost:5000',
  };
  return { modelProfiles, routingPolicy, translatorConfig };
}

describe('POST /v1/evaluate', () => {
  let server: ProxyServer;

  beforeEach(() => {
    mockFetch.mockReset();
    server = new ProxyServer(buildConfig());
  });

  afterEach(async () => {
    await server.stop();
  });

  it('returns 400 when body is missing', async () => {
    const app = server.getApp();
    const res = await app.inject({ method: 'POST', url: '/v1/evaluate' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when targetLanguages is missing', async () => {
    const app = server.getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/evaluate',
      payload: { prompt: 'Hello world' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toContain('targetLanguages');
  });

  it('returns 400 when targetLanguages is empty', async () => {
    const app = server.getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/evaluate',
      payload: { prompt: 'Hello world', targetLanguages: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when neither prompt nor prompts is provided', async () => {
    const app = server.getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/evaluate',
      payload: { targetLanguages: ['fr'] },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toContain('prompt');
  });

  it('returns 400 when prompts array contains non-string entries', async () => {
    const app = server.getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/evaluate',
      payload: { prompts: ['valid', 123], targetLanguages: ['fr'] },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toContain('non-empty string');
  });

  it('returns EvaluationReport for single prompt', async () => {
    // Mock: translator call returns translated text, LLM calls return content
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/translate')) {
        return makeTranslateResponse('Bonjour le monde');
      }
      return makeLLMResponse('LLM response text');
    });

    const app = server.getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/evaluate',
      payload: { prompt: 'Hello world', targetLanguages: ['fr'], modelId: 'test-model' },
    });

    expect(res.statusCode).toBe(200);
    const report = JSON.parse(res.body);
    expect(report.prompt).toBe('Hello world');
    expect(report.baselineLanguage).toBe('en');
    expect(report.baselineScore).toBeDefined();
    expect(report.results).toHaveLength(1);
    expect(report.results[0].language).toBe('fr');
    expect(report.ranking).toBeDefined();
    expect(Array.isArray(report.ranking)).toBe(true);
  });

  it('returns EvaluationReport[] for batch prompts', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/translate')) {
        return makeTranslateResponse('Translated text');
      }
      return makeLLMResponse('LLM response');
    });

    const app = server.getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/evaluate',
      payload: { prompts: ['Hello', 'World'], targetLanguages: ['de'], modelId: 'test-model' },
    });

    expect(res.statusCode).toBe(200);
    const reports = JSON.parse(res.body);
    expect(Array.isArray(reports)).toBe(true);
    expect(reports).toHaveLength(2);
    expect(reports[0].prompt).toBe('Hello');
    expect(reports[1].prompt).toBe('World');
  });

  it('uses default model profile when modelId is not provided', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/translate')) {
        return makeTranslateResponse('Translated');
      }
      return makeLLMResponse('Response');
    });

    const app = server.getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/evaluate',
      payload: { prompt: 'Test prompt', targetLanguages: ['fr'] },
    });

    expect(res.statusCode).toBe(200);
    const report = JSON.parse(res.body);
    expect(report.prompt).toBe('Test prompt');
  });

  it('returns 400 when targetLanguages contains empty strings', async () => {
    const app = server.getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/evaluate',
      payload: { prompt: 'Hello', targetLanguages: ['fr', ''] },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toContain('non-empty string');
  });
});
