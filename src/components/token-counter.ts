/**
 * Precise Token Counter
 *
 * Uses Bedrock's CountTokensCommand for exact token counts when available,
 * falls back to heuristic estimation for OpenAI or when the API call fails.
 * Precise counts make token savings numbers credible for cost reporting.
 */

import type { LLMProvider } from '../models/config.ts';

export interface TokenCount {
  inputTokens: number;
  method: 'bedrock-api' | 'estimation';
}

// Lazy-loaded Bedrock client and command to avoid importing ~279KB at startup
let BedrockClientModule: typeof import('@aws-sdk/client-bedrock-runtime') | null = null;

async function getBedrockModule() {
  if (!BedrockClientModule) {
    BedrockClientModule = await import('@aws-sdk/client-bedrock-runtime');
  }
  return BedrockClientModule;
}

export class TokenCounter {
  private bedrockClients = new Map<string, InstanceType<typeof import('@aws-sdk/client-bedrock-runtime').BedrockRuntimeClient>>();

  /**
   * Count input tokens for a set of messages.
   * Uses Bedrock API for precise counts, falls back to estimation.
   */
  async countInputTokens(
    messages: Array<{ role: string; content: string }>,
    modelId: string,
    provider?: LLMProvider,
    awsRegion?: string,
  ): Promise<TokenCount> {
    if (provider === 'bedrock') {
      try {
        const count = await this.countWithBedrock(messages, modelId, awsRegion ?? 'us-east-1');
        if (count !== null) {
          return { inputTokens: count, method: 'bedrock-api' };
        }
      } catch {
        // Fall through to estimation
      }
    }

    return {
      inputTokens: this.estimateTokens(messages),
      method: 'estimation',
    };
  }

  /**
   * Count tokens using Bedrock's CountTokensCommand.
   * Returns null if the API call fails.
   */
  private async countWithBedrock(
    messages: Array<{ role: string; content: string }>,
    modelId: string,
    region: string,
  ): Promise<number | null> {
    const sdk = await getBedrockModule();
    let client = this.bedrockClients.get(region);
    if (!client) {
      client = new sdk.BedrockRuntimeClient({ region });
      this.bedrockClients.set(region, client);
    }

    // Build the Converse-format request body for token counting
    const systemMessages: string[] = [];
    const conversationMessages: Array<{
      role: string;
      content: Array<{ text: string }>;
    }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg.content);
      } else {
        conversationMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: [{ text: msg.content }],
        });
      }
    }

    if (conversationMessages.length === 0) {
      conversationMessages.push({ role: 'user', content: [{ text: '' }] });
    }

    const requestBody: Record<string, unknown> = {
      anthropic_version: 'bedrock-2023-05-31',
      messages: conversationMessages,
      max_tokens: 1,
    };
    if (systemMessages.length > 0) {
      requestBody.system = systemMessages.map(text => ({ text }));
    }

    const command = new sdk.CountTokensCommand({
      modelId,
      input: {
        invokeModel: {
          body: new TextEncoder().encode(JSON.stringify(requestBody)),
        },
      },
    });

    const response = await client.send(command);
    return response.inputTokens ?? null;
  }

  /**
   * Heuristic token estimation based on script type.
   * Used as fallback when API counting is unavailable.
   */
  estimateTokens(messages: Array<{ role: string; content: string }>): number {
    const fullText = messages.map(m => m.content).join('\n');
    let tokens = 0;

    for (const char of fullText) {
      const code = char.codePointAt(0) ?? 0;
      if (
        (code >= 0x0E00 && code <= 0x0E7F) || // Thai
        (code >= 0x3000 && code <= 0x9FFF) || // CJK
        (code >= 0xAC00 && code <= 0xD7AF) || // Korean Hangul
        (code >= 0x1100 && code <= 0x11FF)    // Korean Jamo
      ) {
        tokens += 1.5;
      } else {
        tokens += 0.25;
      }
    }

    return Math.ceil(tokens);
  }
}
