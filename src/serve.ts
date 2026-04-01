import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ProxyServer } from './pipeline/proxy-server.ts';
import { validateModelProfile } from './config/model-profile-loader.ts';
import { validateRoutingPolicy } from './config/routing-policy-loader.ts';
import type { ModelProfile } from './models/config.ts';

const provider = (process.env.LLM_PROVIDER ?? 'bedrock') as 'openai' | 'bedrock';
const awsRegion = process.env.AWS_REGION ?? 'us-east-1';

const CONFIG_DIR = resolve(process.cwd(), 'config');
const MODEL_PROFILES_PATH = process.env.MODEL_PROFILES_PATH ?? resolve(CONFIG_DIR, 'model-profiles.json');
const ROUTING_POLICY_PATH = process.env.ROUTING_POLICY_PATH ?? resolve(CONFIG_DIR, 'routing-policy.json');

/**
 * Load model profiles from JSON, applying env var overrides for
 * provider, region, endpoint, and model ID.
 */
async function loadProfiles(): Promise<ModelProfile[]> {
  const content = await readFile(MODEL_PROFILES_PATH, 'utf-8');
  const parsed = JSON.parse(content);
  const items = Array.isArray(parsed) ? parsed : [parsed];

  return items.map((item: Record<string, unknown>) => {
    // Apply env var overrides
    if (process.env.BEDROCK_MODEL_ID && provider === 'bedrock') {
      item.modelId = process.env.BEDROCK_MODEL_ID;
    }
    if (provider === 'openai' && !process.env.BEDROCK_MODEL_ID) {
      item.modelId = 'gpt-4o';
    }
    item.provider = provider;
    item.awsRegion = awsRegion;
    item.endpoint = provider === 'bedrock'
      ? `https://bedrock-runtime.${awsRegion}.amazonaws.com`
      : (process.env.LLM_ENDPOINT ?? 'https://api.openai.com/v1/chat/completions');

    return validateModelProfile(item);
  });
}

async function main() {
  const modelProfiles = await loadProfiles();

  const routingContent = await readFile(ROUTING_POLICY_PATH, 'utf-8');
  const routingPolicy = validateRoutingPolicy(JSON.parse(routingContent));

  const server = new ProxyServer({
    modelProfiles,
    routingPolicy,
    translatorConfig: {
      backend: (process.env.TRANSLATOR_BACKEND ?? 'libretranslate') as 'libretranslate' | 'amazon-translate',
      endpoint: process.env.LIBRETRANSLATE_ENDPOINT ?? 'http://localhost:5000',
      awsRegion,
    },
    shadowEnabled: false,
  });

  const PORT = Number(process.env.PORT) || 3000;

  await server.start(PORT);

  const modelId = modelProfiles[0]?.modelId ?? 'unknown';
  const translatorBackend = process.env.TRANSLATOR_BACKEND ?? 'libretranslate';

  console.log(`\n  Multilingual Prompt Optimizer running on http://localhost:${PORT}\n`);
  console.log(`  Endpoints:`);
  console.log(`    POST /v1/chat/completions  — proxied chat completions`);
  console.log(`    POST /v1/evaluate          — multilingual evaluation\n`);
  console.log(`  Provider: ${provider}`);
  console.log(`  Model:    ${modelId}`);
  if (provider === 'bedrock') {
    console.log(`  Region:   ${awsRegion}`);
  }
  console.log(`  Translator: ${translatorBackend}`);
  if (translatorBackend === 'libretranslate') {
    console.log(`  LibreTranslate: ${process.env.LIBRETRANSLATE_ENDPOINT ?? 'http://localhost:5000 (default)'}`);
  } else if (translatorBackend === 'amazon-translate') {
    console.log(`  Amazon Translate region: ${awsRegion}`);
  }
  console.log(`\n  Config files:`);
  console.log(`    Model profiles:  ${MODEL_PROFILES_PATH}`);
  console.log(`    Routing policy:  ${ROUTING_POLICY_PATH}`);
  console.log('');
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
