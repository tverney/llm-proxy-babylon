import type { LLMRequest, LLMResponse } from '../models/types.ts';
import type { LLMProvider } from '../models/config.ts';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message as BedrockMessage,
  type ContentBlock,
} from '@aws-sdk/client-bedrock-runtime';

export class LLMForwarder {
  private bedrockClients = new Map<string, BedrockRuntimeClient>();

  private getBedrockClient(region: string): BedrockRuntimeClient {
    let client = this.bedrockClients.get(region);
    if (!client) {
      client = new BedrockRuntimeClient({ region });
      this.bedrockClients.set(region, client);
    }
    return client;
  }

  /**
   * Forward a synchronous request to the target LLM endpoint.
   * Supports both OpenAI-compatible APIs and AWS Bedrock.
   */
  async forward(
    request: LLMRequest,
    endpoint: string,
    headers?: Record<string, string>,
    provider?: LLMProvider,
    awsRegion?: string,
  ): Promise<LLMResponse> {
    if (provider === 'bedrock') {
      return this.forwardBedrock(request, awsRegion ?? 'us-east-1');
    }
    return this.forwardOpenAI(request, endpoint, headers);
  }

  /**
   * Forward via standard OpenAI-compatible HTTP endpoint.
   */
  private async forwardOpenAI(
    request: LLMRequest,
    endpoint: string,
    headers?: Record<string, string>,
  ): Promise<LLMResponse> {
    const { stream: _stream, ...rest } = request;
    const body = { ...rest, stream: false };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

    const raw = await response.json();
    const content = this.extractContent(raw);

    return { raw, content, statusCode: response.status };
  }

  /**
   * Forward via AWS Bedrock Converse API.
   * Converts OpenAI chat format to Bedrock's message format and back.
   */
  private async forwardBedrock(request: LLMRequest, region: string): Promise<LLMResponse> {
    const client = this.getBedrockClient(region);

    // Separate system messages from conversation messages
    const systemMessages: string[] = [];
    const conversationMessages: BedrockMessage[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg.content);
      } else {
        const role = msg.role === 'assistant' ? 'assistant' : 'user';
        conversationMessages.push({
          role,
          content: [{ text: msg.content } as ContentBlock],
        });
      }
    }

    // Bedrock requires at least one user message
    if (conversationMessages.length === 0) {
      conversationMessages.push({
        role: 'user',
        content: [{ text: '' } as ContentBlock],
      });
    }

    try {
      const command = new ConverseCommand({
        modelId: request.model,
        messages: conversationMessages,
        ...(systemMessages.length > 0 && {
          system: systemMessages.map(text => ({ text })),
        }),
        ...(request.temperature !== undefined && {
          inferenceConfig: {
            temperature: request.temperature as number,
            ...(request.max_tokens !== undefined && { maxTokens: request.max_tokens as number }),
          },
        }),
      });

      const response = await client.send(command);

      const outputText =
        response.output?.message?.content
          ?.map(block => block.text ?? '')
          .join('') ?? '';

      // Build an OpenAI-compatible response shape so the rest of the pipeline works
      const raw = {
        id: `bedrock-${Date.now()}`,
        object: 'chat.completion',
        model: request.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: outputText },
            finish_reason: response.stopReason ?? 'stop',
          },
        ],
        usage: {
          prompt_tokens: response.usage?.inputTokens ?? 0,
          completion_tokens: response.usage?.outputTokens ?? 0,
          total_tokens: (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0),
        },
      };

      return { raw, content: outputText, statusCode: 200 };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? 500;
      const raw = { error: { message, type: 'bedrock_error' } };
      return { raw, content: message, statusCode };
    }
  }

  /**
   * Forward a streaming request to the target LLM endpoint.
   * Yields raw SSE chunks as they arrive from the LLM.
   */
  async *forwardStream(
    request: LLMRequest,
    endpoint: string,
    headers?: Record<string, string>,
  ): AsyncIterable<unknown> {
    const { stream: _stream, ...rest } = request;
    const body = { ...rest, stream: true };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new LLMForwarderError(response.status, errorBody);
    }

    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data);
          } catch {
            yield data;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Extract text content from an OpenAI-compatible response body.
   */
  private extractContent(raw: unknown): string {
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj.choices) && obj.choices.length > 0) {
        const choice = obj.choices[0] as Record<string, unknown>;
        if (choice.message && typeof choice.message === 'object') {
          const msg = choice.message as Record<string, unknown>;
          if (typeof msg.content === 'string') return msg.content;
        }
      }
      if (obj.error) return JSON.stringify(obj.error);
    }
    return '';
  }
}

export class LLMForwarderError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorBody: unknown,
  ) {
    super(`LLM API error: ${statusCode}`);
    this.name = 'LLMForwarderError';
  }
}
