// Feature: multilingual-prompt-optimizer, Property 12: LLM error propagation
import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { LLMForwarder } from '../src/components/llm-forwarder.ts';

/**
 * **Validates: Requirements 6.3**
 *
 * Property 12: LLM error propagation
 * For any error response from the target LLM API, the Optimizer SHALL return
 * a response to the caller with the same HTTP status code and error message
 * as the original LLM error.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** Arbitrary for HTTP error status codes (4xx and 5xx). */
const httpErrorStatusArb = fc.oneof(
  fc.constant(400),
  fc.constant(401),
  fc.constant(403),
  fc.constant(404),
  fc.constant(429),
  fc.constant(500),
  fc.constant(502),
  fc.constant(503),
  fc.integer({ min: 400, max: 599 }),
);

/** Arbitrary for OpenAI-style error response bodies. */
const errorBodyArb = fc.oneof(
  // OpenAI-style structured error
  fc.record({
    error: fc.record({
      message: fc.string({ minLength: 1, maxLength: 200 }),
      type: fc.constantFrom(
        'invalid_request_error',
        'authentication_error',
        'rate_limit_error',
        'server_error',
      ),
      code: fc.oneof(fc.string({ minLength: 1, maxLength: 50 }), fc.constant(null)),
    }),
  }),
  // Simple string error
  fc.record({
    error: fc.string({ minLength: 1, maxLength: 200 }),
  }),
  // Error with nested message and status
  fc.record({
    error: fc.record({
      message: fc.string({ minLength: 1, maxLength: 200 }),
    }),
    status: fc.integer({ min: 400, max: 599 }),
  }),
);

/** Arbitrary for a minimal valid LLMRequest. */
const llmRequestArb = fc.record({
  model: fc.constantFrom('gpt-4', 'gpt-3.5-turbo', 'claude-3'),
  messages: fc.constant([{ role: 'user', content: 'Hello' }]),
});

/** Helper: mock global fetch to return a specific status and JSON body. */
function mockFetch(statusCode: number, body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: statusCode,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('LLM Error Propagation - Property-Based Tests', () => {
  it('Property 12a: Error status codes are propagated faithfully', async () => {
    // Collect generated test cases synchronously, then verify each
    const cases: Array<{ statusCode: number; errorBody: unknown; request: { model: string; messages: Array<{ role: string; content: string }> } }> = [];

    fc.assert(
      fc.property(httpErrorStatusArb, errorBodyArb, llmRequestArb, (statusCode, errorBody, request) => {
        cases.push({ statusCode, errorBody, request });
      }),
      { numRuns: 100 },
    );

    const forwarder = new LLMForwarder();

    for (const { statusCode, errorBody, request } of cases) {
      mockFetch(statusCode, errorBody);
      const response = await forwarder.forward(request, 'http://mock-llm/v1/chat/completions');
      expect(response.statusCode).toBe(statusCode);
    }
  });

  it('Property 12b: Error response body is preserved in raw field', async () => {
    const cases: Array<{ statusCode: number; errorBody: unknown; request: { model: string; messages: Array<{ role: string; content: string }> } }> = [];

    fc.assert(
      fc.property(httpErrorStatusArb, errorBodyArb, llmRequestArb, (statusCode, errorBody, request) => {
        cases.push({ statusCode, errorBody, request });
      }),
      { numRuns: 100 },
    );

    const forwarder = new LLMForwarder();

    for (const { statusCode, errorBody, request } of cases) {
      mockFetch(statusCode, errorBody);
      const response = await forwarder.forward(request, 'http://mock-llm/v1/chat/completions');
      expect(response.raw).toEqual(errorBody);
    }
  });

  it('Property 12c: Error content is extractable from the response', async () => {
    const cases: Array<{ statusCode: number; errorBody: Record<string, unknown>; request: { model: string; messages: Array<{ role: string; content: string }> } }> = [];

    fc.assert(
      fc.property(httpErrorStatusArb, errorBodyArb, llmRequestArb, (statusCode, errorBody, request) => {
        cases.push({ statusCode, errorBody: errorBody as Record<string, unknown>, request });
      }),
      { numRuns: 100 },
    );

    const forwarder = new LLMForwarder();

    for (const { statusCode, errorBody, request } of cases) {
      mockFetch(statusCode, errorBody);
      const response = await forwarder.forward(request, 'http://mock-llm/v1/chat/completions');

      // Content must always be a string
      expect(typeof response.content).toBe('string');

      // When the body has an error field, the forwarder should extract it
      if (typeof errorBody.error !== 'undefined') {
        expect(response.content.length).toBeGreaterThan(0);
      }
    }
  });

  it('Property 12d: Success responses propagate status code correctly', async () => {
    const requests: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = [];
    const successBody = {
      choices: [{ message: { role: 'assistant', content: 'Hello there!' } }],
    };

    fc.assert(
      fc.property(llmRequestArb, (request) => {
        requests.push(request);
      }),
      { numRuns: 100 },
    );

    const forwarder = new LLMForwarder();

    for (const request of requests) {
      mockFetch(200, successBody);
      const response = await forwarder.forward(request, 'http://mock-llm/v1/chat/completions');
      expect(response.statusCode).toBe(200);
      expect(response.content).toBe('Hello there!');
    }
  });
});
