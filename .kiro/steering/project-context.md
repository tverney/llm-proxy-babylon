---
inclusion: auto
---

# LLM Proxy Babylon — Project Context

## What This Project Is

An OpenAI-compatible HTTP proxy that intercepts LLM API requests, detects input language, and selectively pre-translates non-English prompts to English before forwarding to the LLM. Instead of back-translating responses, it appends a language instruction (e.g., "Please respond in Thai") so the LLM responds directly in the user's language.

## Architecture

Pipeline: detect → parse → classify → route → translate + inject language instruction → forward → respond

Key components in `src/components/`:
- `language-detector.ts` — BCP-47 detection via franc
- `mixed-content-parser.ts` — separates translatable text from code/URLs/JSON
- `content-classifier.ts` — task type classification (reasoning, math, code-gen, culturally-specific)
- `routing-engine.ts` — decides skip/translate/hybrid per request
- `translator.ts` — pluggable backends: LibreTranslate, Amazon Translate
- `llm-forwarder.ts` — forwards to OpenAI-compatible APIs or AWS Bedrock (Converse API)
- `shadow-evaluator.ts` — optional parallel baseline comparison
- `metrics-collector.ts` — logs decisions, latencies, quality scores
- `multilingual-evaluator.ts` — benchmarks prompts across languages via /v1/evaluate
- `conversation-cache.ts` — caches translated messages per conversation for multi-turn efficiency

Pipeline orchestration: `src/pipeline/pipeline.ts`
Proxy server: `src/pipeline/proxy-server.ts`
Entry point: `src/serve.ts`

## Key Design Decisions

- TypeScript with Fastify for the HTTP server
- AWS Bedrock support via Converse API (Amazon Nova Lite, Mistral 7B tested)
- Amazon Translate and LibreTranslate as translation backends
- Property-based testing with fast-check (141 tests, 33 test files)
- Debug mode via `X-Debug: true` header (includes translated prompt, baseline comparison, token savings)
- Conversation cache via `X-Conversation-Id` header (1000 conversations, 30min TTL)

## Configuration

Environment variables:
- `LLM_PROVIDER` — bedrock or openai
- `AWS_REGION` — Bedrock region
- `BEDROCK_MODEL_ID` — model ID (default: us.amazon.nova-lite-v1:0)
- `TRANSLATOR_BACKEND` — libretranslate or amazon-translate
- `LIBRETRANSLATE_ENDPOINT` — LibreTranslate URL
- `PORT` — server port (default: 3000)

## Testing

Run all tests: `npm test`
All correctness properties from the design doc are covered by property-based tests with 100+ iterations each.

## References

- Spec: `.kiro/specs/multilingual-prompt-optimizer/` (requirements.md, design.md, tasks.md)
- GitHub: https://github.com/tverney/llm-proxy-babylon
- Article: https://builder.aws.com/content/3BfRX8ILgQnT0aO1vmYWvgVCHKT/the-irony-of-language-models-that-dont-speak-your-language
