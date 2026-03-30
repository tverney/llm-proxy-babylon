// Feature: multilingual-prompt-optimizer, Property 26: Missing fields return 400
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ProxyServer } from '../src/pipeline/proxy-server.ts';
import type { ProxyServerConfig } from '../src/pipeline/proxy-server.ts';
import type { ModelProfile } from '../src/models/config.ts';

/**
 * **Validates: Requirements 13.3**
 *
 * Property 26: Missing fields return 400
 * For any incoming HTTP request that is missing required fields (model, messages),
 * the Optimizer SHALL return an HTTP 400 response with a descriptive error message.
 */

const defaultProfile: ModelProfile = {
  modelId: 'test-model',
  supportedLanguages: ['en'],
  languagePerformance: [{ languageTag: 'en', performanceRating: 1.0 }],
  defaultOptimalLanguage: 'en',
  endpoint: 'http://localhost:9999',
};

const serverConfig: ProxyServerConfig = {
  modelProfiles: [defaultProfile],
  routingPolicy: { rules: [] },
  translatorConfig: { backend: 'libretranslate', endpoint: 'http://localhost:5000' },
};

function createServer(): ProxyServer {
  return new ProxyServer(serverConfig);
}

describe('Property 26: Missing fields return 400', () => {
  it('should return 400 when request body is an empty object or has no required fields', async () => {
    const server = createServer();
    const app = server.getApp();

    // Empty object — missing both model and messages
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.error).toBeDefined();
    expect(typeof json.error.message).toBe('string');
    expect(json.error.message.length).toBeGreaterThan(0);

    await server.stop();
  });

  it('should return 400 when model field is missing or not a string', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.constant(''),
          fc.integer(),
          fc.boolean(),
          fc.constant([]),
          fc.constant({}),
        ),
        async (modelValue) => {
          const server = createServer();
          const app = server.getApp();

          const body: Record<string, unknown> = {
            messages: [{ role: 'user', content: 'Hello' }],
          };
          if (modelValue !== undefined) {
            body.model = modelValue;
          }

          const response = await app.inject({
            method: 'POST',
            url: '/v1/chat/completions',
            payload: body,
          });

          expect(response.statusCode).toBe(400);
          const json = response.json();
          expect(json.error).toBeDefined();
          expect(typeof json.error.message).toBe('string');
          expect(json.error.message.toLowerCase()).toContain('model');

          await server.stop();
        },
      ),
      { numRuns: 20 },
    );
  });

  it('should return 400 when messages field is missing, not an array, or empty', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.constant('not-an-array'),
          fc.integer(),
          fc.boolean(),
          fc.constant({}),
          fc.constant([]),
        ),
        async (messagesValue) => {
          const server = createServer();
          const app = server.getApp();

          const body: Record<string, unknown> = {
            model: 'test-model',
          };
          if (messagesValue !== undefined) {
            body.messages = messagesValue;
          }

          const response = await app.inject({
            method: 'POST',
            url: '/v1/chat/completions',
            payload: body,
          });

          expect(response.statusCode).toBe(400);
          const json = response.json();
          expect(json.error).toBeDefined();
          expect(typeof json.error.message).toBe('string');
          expect(json.error.message.toLowerCase()).toContain('messages');

          await server.stop();
        },
      ),
      { numRuns: 20 },
    );
  });

  it('should return 400 when both model and messages are missing from arbitrary objects', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 10 }).filter(
            (k) => k !== 'model' && k !== 'messages',
          ),
          fc.oneof(fc.string(), fc.integer(), fc.boolean()),
          { minKeys: 0, maxKeys: 5 },
        ),
        async (extraFields) => {
          const server = createServer();
          const app = server.getApp();

          const response = await app.inject({
            method: 'POST',
            url: '/v1/chat/completions',
            payload: extraFields,
          });

          expect(response.statusCode).toBe(400);
          const json = response.json();
          expect(json.error).toBeDefined();
          expect(typeof json.error.message).toBe('string');
          expect(json.error.message.length).toBeGreaterThan(0);

          await server.stop();
        },
      ),
      { numRuns: 50 },
    );
  });
});
