import { ProxyServer } from './pipeline/proxy-server.ts';

const provider = (process.env.LLM_PROVIDER ?? 'bedrock') as 'openai' | 'bedrock';
const awsRegion = process.env.AWS_REGION ?? 'us-east-1';

const server = new ProxyServer({
  modelProfiles: [
    {
      modelId: provider === 'bedrock'
        ? (process.env.BEDROCK_MODEL_ID ?? 'us.amazon.nova-lite-v1:0')
        : 'gpt-4o',
      supportedLanguages: ['en', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'pt'],
      languagePerformance: [
        { languageTag: 'en', performanceRating: 1.0 },
        { languageTag: 'zh', performanceRating: 0.92 },
        { languageTag: 'ja', performanceRating: 0.88 },
        { languageTag: 'ko', performanceRating: 0.85 },
        { languageTag: 'de', performanceRating: 0.90 },
        { languageTag: 'fr', performanceRating: 0.91 },
        { languageTag: 'es', performanceRating: 0.93 },
        { languageTag: 'pt', performanceRating: 0.89 },
      ],
      defaultOptimalLanguage: 'en',
      endpoint: provider === 'bedrock'
        ? `https://bedrock-runtime.${awsRegion}.amazonaws.com`
        : (process.env.LLM_ENDPOINT ?? 'https://api.openai.com/v1/chat/completions'),
      provider,
      awsRegion,
    },
  ],
  routingPolicy: {
    rules: [
      {
        priority: 1,
        matchConditions: { taskTypes: ['culturally-specific'] },
        action: 'skip',
      },
      {
        priority: 2,
        matchConditions: {
          taskTypes: ['reasoning', 'math', 'code-generation', 'general'],
          sourceLanguagePattern: '^(?!en).*$',
        },
        action: 'translate',
        targetLanguage: 'en',
        shadowEvaluation: false,
      },
    ],
  },
  translatorConfig: {
    backend: (process.env.TRANSLATOR_BACKEND ?? 'libretranslate') as 'libretranslate' | 'amazon-translate',
    endpoint: process.env.LIBRETRANSLATE_ENDPOINT ?? 'http://localhost:5000',
    awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  },
  shadowEnabled: false,
});

const PORT = Number(process.env.PORT) || 3000;

server.start(PORT).then(() => {
  console.log(`\n  Multilingual Prompt Optimizer running on http://localhost:${PORT}\n`);
  console.log(`  Endpoints:`);
  console.log(`    POST /v1/chat/completions  — proxied chat completions`);
  console.log(`    POST /v1/evaluate          — multilingual evaluation\n`);
  console.log(`  Provider: ${provider}`);
  if (provider === 'bedrock') {
    console.log(`  Model:    ${process.env.BEDROCK_MODEL_ID ?? 'us.amazon.nova-lite-v1:0'}`);
    console.log(`  Region:   ${awsRegion}`);
  }
  const translatorBackend = process.env.TRANSLATOR_BACKEND ?? 'libretranslate';
  console.log(`  Translator: ${translatorBackend}`);
  if (translatorBackend === 'libretranslate') {
    console.log(`  LibreTranslate: ${process.env.LIBRETRANSLATE_ENDPOINT ?? 'http://localhost:5000 (default)'}`);
  } else if (translatorBackend === 'amazon-translate') {
    console.log(`  Amazon Translate region: ${awsRegion}`);
  }
  console.log('');
});
