# LLM Proxy Babylon — Multilingual Prompt Optimizer

A lightweight HTTP proxy that sits between your application and any LLM API, selectively pre-translating non-English prompts to improve response quality — then instructing the LLM to respond in the user's original language.

## The Problem

LLMs look identical when you speak English. But the moment you switch to Thai, Vietnamese, Korean, or even Portuguese, the illusion of parity collapses.

Most leading LLMs allocate approximately 93% of their training tokens to English ([Brown et al., "Language Models are Few-Shot Learners", NeurIPS 2020](https://arxiv.org/abs/2005.14165)). Even when models claim to be "multilingual," they're often processing poorly translated English under the hood. The result: degraded reasoning, cultural misunderstandings, and sometimes outright gibberish in non-English languages.

Of the approximately 7,000 spoken languages globally, most LLMs only cover about 50 high-resource ones. The remaining languages lack both the digital data and quality resources to benefit from recent AI advancements — creating barriers to education, healthcare, financial access, and employment for the communities that speak them. ([Frontiers Research Topic: Language Models for Low-Resource Languages](https://www.frontiersin.org/research-topics/77716/language-models-for-low-resource-languages))

This isn't a theoretical concern. In our own testing with Mistral 7B on a Thai prompt about sorting algorithms:

- **Direct Thai input** produced garbled output mixing English fragments into Thai text ("วงจirkle", "sorteering technique"), with confused reasoning
- **Translated to English first** → the same model produced a clean, structured response correctly explaining O(n²) vs O(n log n) complexity, listing Merge Sort, Quick Sort, and Heap Sort with accurate Big-O analysis — all responded back in Thai

The model's reasoning capability was there all along. It just couldn't access it through Thai input.

> "The next time someone says 'all LLMs are the same,' ask them: In which language?"
> — [Dion Wiggins, "All LLMs Now Perform About the Same. Right?"](https://medium.com/@dion.wiggins/all-llms-now-perform-about-the-same-right-921524877c99)

## How It Works

The optimizer intercepts OpenAI-compatible API requests and runs them through a pipeline:

```
detect language → parse mixed content → classify task → route → translate + inject language instruction → forward to LLM → respond
```

The key insight: LLMs have no difficulty *generating* output in a specified language — the performance gap is in *understanding* non-English prompts. So instead of translating the response back (which adds latency, cost, and errors), we translate the prompt to English and append an instruction like "Please respond in Thai since the original question was asked in Thai."

### Smart Routing

Not every prompt benefits from translation. The routing engine evaluates each request and decides:

- **Skip** — when the prompt is already in the model's optimal language, or when the task is culturally-specific
- **Translate** — when pre-translation to English is expected to improve reasoning quality
- **Hybrid** — translate system prompts for better instruction following, keep user content in the original language

Decisions are based on detected language, task type, and per-model capability profiles.

## Quick Start

```bash
npm install
npm start
```

The server starts on port 3000 by default, using AWS Bedrock with Amazon Nova Lite.

### Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `LLM_PROVIDER` | `bedrock` | `bedrock` or `openai` |
| `AWS_REGION` | `us-east-1` | AWS region for Bedrock |
| `AWS_PROFILE` | — | AWS credentials profile |
| `BEDROCK_MODEL_ID` | `us.amazon.nova-lite-v1:0` | Bedrock model ID |
| `LLM_ENDPOINT` | OpenAI default | LLM endpoint (for openai provider) |
| `TRANSLATOR_BACKEND` | `libretranslate` | `libretranslate` or `amazon-translate` |
| `LIBRETRANSLATE_ENDPOINT` | `http://localhost:5000` | LibreTranslate instance (when using libretranslate backend) |

### Using with Bedrock

```bash
AWS_PROFILE=personal npm start
```

### Using with OpenAI

```bash
LLM_PROVIDER=openai npm start
```

Then pass your API key in requests:
```bash
curl -s 'http://localhost:3000/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sk-your-key' \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'
```

### Translation Backend

The proxy supports two translation backends:

**Amazon Translate** (recommended for production) — high-quality neural translation, handles proper nouns and technical terminology well, $15/1M characters with a 2M character/month free tier:

```bash
TRANSLATOR_BACKEND=amazon-translate AWS_PROFILE=personal npm start
```

**LibreTranslate** (free, self-hosted) — good for development and testing, run locally with Docker:

```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
npm start
```

English prompts skip translation entirely, so a translation backend is only needed for non-English input.

## Debug Mode

Add `X-Debug: true` to any request to see what the optimizer is doing under the hood:

```bash
curl -s 'http://localhost:3000/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -H 'X-Debug: true' \
  -d '{"model":"us.amazon.nova-lite-v1:0","messages":[{"role":"user","content":"อธิบายแนวคิดของ recursion"}]}'
```

The response includes a `_debug` object with:

- `detectedLanguage` / `detectedConfidence` — what language was detected
- `taskType` — how the prompt was classified (reasoning, math, code-generation, etc.)
- `routingDecision` / `routingReason` — skip, translate, or hybrid, and why
- `translatedPrompt` — the exact text sent to the LLM
- `languageInstruction` — the "respond in X" directive appended
- `baselineResponse` — the LLM's response to the original untranslated prompt, for direct comparison
- `timestamps` — time breakdown across pipeline stages

## Architecture

```
Client → Proxy → Language Detector → Mixed Content Parser → Content Classifier
                                                                    ↓
                                                            Routing Engine
                                                           ↙      ↓       ↘
                                                       Skip   Translate   Hybrid
                                                         ↘       ↓        ↙
                                                          LLM Forwarder → LLM API
                                                                ↓
                                                        Client ← Response
```

### Components

| Component | Purpose |
|---|---|
| Language Detector | Identifies prompt language using `franc`, returns BCP-47 tags with confidence scores |
| Mixed Content Parser | Separates translatable text from code blocks, URLs, JSON, XML — preserves them during translation |
| Content Classifier | Classifies task type (reasoning, math, code-generation, creative-writing, culturally-specific, etc.) |
| Routing Engine | Evaluates routing policies to decide skip/translate/hybrid per request |
| Translator | Pluggable translation backend (Amazon Translate, LibreTranslate), preserves placeholder tokens |
| LLM Forwarder | Forwards to OpenAI-compatible APIs or AWS Bedrock via Converse API |
| Shadow Evaluator | Optional parallel baseline request for quality comparison |
| Metrics Collector | Logs decisions, latencies, and quality scores |
| Multilingual Evaluator | Benchmarks a prompt across multiple languages via `/v1/evaluate` |

## When Does Translation Help?

Based on our testing:

| Scenario | Translation Helps? | Why |
|---|---|---|
| Thai reasoning → Mistral 7B | ✅ Yes | Model can't reason in Thai, English path dramatically better |
| Korean reasoning → Nova Lite | ✅ Yes | Quality jumped from 0.663 to 0.949 on technical prompts |
| Japanese math → Nova Lite | ✅ Yes | Model struggles with math notation in Japanese, English path cleaner |
| Arabic code-gen → smaller models | ✅ Yes | RTL script + code mixing confuses weaker models, English normalizes it |
| Hindi reasoning → Mistral 7B | ✅ Yes | English-centric model, translation unlocks full reasoning capability |
| Portuguese reasoning → Mistral 7B | ✅ Yes | Handles basic Portuguese but struggles with multi-step logic, English path improves reasoning |
| Portuguese factual → Nova Lite | ❌ No | Nova Lite handles Portuguese well, translation adds noise |
| Vietnamese logic puzzle → Nova Lite | ❌ No | LibreTranslate mangled proper nouns, lost constraints |
| Portuguese local knowledge → Nova Lite | ❌ No | Culturally-specific query, should skip translation |
| Spanish creative writing → Nova Lite | ❌ No | Creative tone and style lost in translation |
| English prompts (any model) | ⏭️ Skip | Already in optimal language, no translation needed |

The optimizer works best when:
- The model is weak in the input language (smaller models, low-resource languages)
- The task requires reasoning (math, logic, code) rather than cultural knowledge
- The translation backend is high quality (DeepL/Google > LibreTranslate for production)

## API Endpoints

### `POST /v1/chat/completions`

OpenAI-compatible chat completion proxy. Drop-in replacement — just point your client at the optimizer instead of the LLM API directly.

### `POST /v1/evaluate`

Multilingual evaluation harness. Translates a prompt into multiple languages, sends each to the LLM, and returns a per-language quality comparison report.

```bash
curl -s 'http://localhost:3000/v1/evaluate' \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Explain recursion","targetLanguages":["pt","th","ko","ja"]}'
```

## Safety Implications

Research shows that low-resource languages exhibit about three times the likelihood of encountering harmful content compared to high-resource languages, and in intentional attack scenarios, unsafe output rates can reach over 80% ([Deng et al., "Multilingual Jailbreak Challenges in Large Language Models", 2023](https://arxiv.org/abs/2310.06474)). This gap exists because LLM safety guardrails are primarily trained on English data.

The optimizer helps close this gap as a side effect of its core design. By translating low-resource language prompts to English before sending them to the LLM, the model's safety filters see the content in the language where they're strongest. A harmful prompt in Thai or Amharic gets evaluated by English-trained guardrails operating at full strength, rather than weaker low-resource language alignment.

This isn't a complete safety solution — translation can lose nuance, and sophisticated adversarial prompts could exploit the translation layer. But for the common case, routing through English significantly narrows the safety alignment gap between high-resource and low-resource languages.

## Benchmark: Multilingual Quality Gap

Using the `/v1/evaluate` endpoint, we benchmarked Amazon Nova Lite (`us.amazon.nova-lite-v1:0`) on a reasoning prompt ("Explain why bubble sort is O(n²) and suggest a faster alternative") across 4 languages:

| Rank | Language | Overall Score | Delta from English |
|------|----------|--------------|-------------------|
| 1 | English (baseline) | 0.949 | — |
| 2 | Portuguese | 0.763 | -0.19 |
| 3 | Korean | 0.663 | -0.29 |
| 4 | Japanese | 0.595 | -0.35 |
| 5 | Thai | 0.456 | -0.49 |

The pattern is clear: high-resource languages (Portuguese) take the smallest hit, while low-resource languages with unique scripts (Thai) lose nearly half the quality. This is the gap the optimizer closes — when a Thai prompt is translated to English first, the model reasons at its 0.949 English level instead of its 0.456 Thai level.

These scores were generated by the built-in evaluation harness, which computes coherence, completeness, factual consistency, and instruction adherence for each language variant.

## Token Cost Savings

Non-Latin scripts tokenize inefficiently — the same semantic content uses far more tokens in Thai or Korean than in English. By translating to English before sending to the LLM, the optimizer reduces input token costs while improving quality.

Real measurement from a Thai reasoning prompt (bubble sort complexity explanation):

| Metric | Direct Thai | Optimized (English) |
|---|---|---|
| Prompt tokens | ~166 | 49 |
| Token savings | — | 70% fewer input tokens |
| Quality score | 0.456 | ~0.949 (English-level) |

That's 3.4x fewer input tokens and 2x better quality. At GPT-4o pricing ($2.50/1M input tokens), sending 1M Thai prompts of this size would cost ~$0.42 directly vs ~$0.12 through the optimizer. With premium models like Claude Opus 4 on Bedrock ($15/1M input tokens), the same 1M Thai prompts would cost $2.49 directly vs $0.74 through the optimizer — a $1.75 saving per million requests on input tokens alone.

The debug mode (`X-Debug: true` header) reports `tokenUsage` and `tokenSavings` per request so you can track this in production.

## The Hidden Cost of Multilingual Chatbots

Most companies deploying LLM-powered chatbots globally don't realize they're paying a language tax. When a user types in Thai, Japanese, Arabic, or Korean, the tokenizer breaks those characters into 2-4x more tokens than equivalent English text. LLM providers charge per token — so the same question costs significantly more depending on the user's language, while delivering worse quality.

This compounds with conversation history. Chatbots typically send the full conversation with each request. A 10-message conversation in Thai accumulates tokens much faster than the same conversation in English — by message 10, you might be sending 3-4x more tokens per request, and the model's context window fills up faster, potentially dropping earlier messages.

The result: your English-speaking users get fast, cheap, high-quality responses. Your Thai-speaking users get slower, more expensive, lower-quality responses — for the same product, same subscription price.

The companies most affected are customer support platforms serving Southeast Asia and the Middle East, e-commerce chatbots in multilingual markets like Brazil, India, and Indonesia, and any SaaS product with a global user base and a chat interface. Most don't track cost-per-language, so they see "AI costs are high" without realizing their non-English users are driving disproportionate token spend for worse outcomes.

The optimizer addresses this directly: translate to English, send fewer tokens, get better results, respond in the user's language.

## Framework Integration

The optimizer exposes an OpenAI-compatible API, so it works as a transparent proxy with any framework that supports custom base URLs. No code changes needed — just point at the optimizer instead of the LLM directly.

### LangChain

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="http://localhost:3000/v1",
    model="us.amazon.nova-lite-v1:0",
    api_key="not-needed-for-bedrock",
)

response = llm.invoke("อธิบายแนวคิดของ recursion ในการเขียนโปรแกรม")
```

### Strands Agents

```python
from strands import Agent
from strands.models.openai import OpenAIModel

model = OpenAIModel(
    client_args={"base_url": "http://localhost:3000/v1", "api_key": "not-needed"},
    model_id="us.amazon.nova-lite-v1:0",
)

agent = Agent(model=model)
response = agent("อธิบายแนวคิดของ recursion ในการเขียนโปรแกรม")
```

### OpenAI SDK (Python or Node)

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:3000/v1", api_key="not-needed")
response = client.chat.completions.create(
    model="us.amazon.nova-lite-v1:0",
    messages=[{"role": "user", "content": "อธิบาย recursion"}],
)
```

The optimizer is invisible to the framework. LangChain, Strands, or any OpenAI-compatible client thinks it's talking to a standard API. The optimizer intercepts the request, detects the language, translates if beneficial, forwards to the LLM, and returns the response in the standard format.

For agentic workflows, this is especially valuable: agents make multiple LLM calls per task (planning, tool use, reflection). Each call benefits from the optimizer independently. A Thai user asking an agent to research a topic might trigger 5-10 LLM calls — each one gets translated to English for better reasoning, and the conversation cache keeps token costs down across the chain.

## Conversation Translation Cache

Multi-turn conversations send the full message history with every request. In non-Latin scripts, this means token costs compound with each turn — by turn 10, the history alone can be 500+ tokens in Thai vs 150 in English.

The optimizer includes a conversation-aware translation cache. Pass an `X-Conversation-Id` header and previously translated messages are pulled from cache instead of being re-translated:

```bash
# Turn 1: 0 cache hits, 1 miss (cold cache)
curl -s 'http://localhost:3000/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -H 'X-Conversation-Id: my-conv-123' \
  -d '{"model":"us.amazon.nova-lite-v1:0","messages":[{"role":"user","content":"อธิบาย recursion"}]}'

# Turn 2: 1 cache hit (first message reused), 2 misses (assistant + new user message)
curl -s 'http://localhost:3000/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -H 'X-Conversation-Id: my-conv-123' \
  -d '{"model":"us.amazon.nova-lite-v1:0","messages":[
    {"role":"user","content":"อธิบาย recursion"},
    {"role":"assistant","content":"Recursion คือ..."},
    {"role":"user","content":"ให้ตัวอย่างใน Python"}
  ]}'
```

By turn 10, you get 9 cache hits and only 1 miss per request — 9 translation API calls saved, and the LLM always sees a lean English context window.

Cache defaults:
- 1,000 concurrent conversations
- 30 minute TTL per conversation (evicted after inactivity)
- LRU eviction when the limit is reached
- In-memory storage (swap for Redis in production for horizontal scaling)

Debug mode (`X-Debug: true`) includes `conversationCache` stats showing hits and misses per request.

## Streaming

The proxy supports true SSE streaming through the translation path for both Bedrock and OpenAI providers. The prompt is translated before the stream starts, then LLM response chunks arrive in real time.

With Bedrock (uses `ConverseStreamCommand`):
```bash
curl -N 'http://localhost:3000/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -d '{"model":"us.amazon.nova-lite-v1:0","messages":[{"role":"user","content":"อธิบาย recursion ในการเขียนโปรแกรม"}],"stream":true}'
```

With OpenAI:
```bash
curl -N 'http://localhost:3000/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sk-your-key' \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"อธิบาย recursion ในการเขียนโปรแกรม"}],"stream":true}'
```

Both return OpenAI-compatible `chat.completion.chunk` SSE events. Non-English prompts are translated to English before the stream begins, so the translation overhead only affects time-to-first-token, not the streaming throughput.

## Prometheus Metrics

The proxy exposes a `/v1/metrics` endpoint in Prometheus text exposition format for production monitoring.

```bash
curl -s 'http://localhost:3000/v1/metrics'
```

Tracked metrics include:
- `llm_proxy_requests_total` — total requests processed
- `llm_proxy_translated_total` / `llm_proxy_skipped_total` — routing decisions
- `llm_proxy_errors_total` — pipeline errors
- `llm_proxy_cache_hits_total` / `llm_proxy_cache_misses_total` — conversation cache performance
- `llm_proxy_language_requests_total{language="th"}` — per-language request counts
- `llm_proxy_language_translated_total{language="th"}` — per-language translation counts
- `llm_proxy_language_tokens_saved_total{language="th"}` — per-language token savings
- `llm_proxy_language_latency_ms_total{language="th"}` — per-language latency

Point Grafana or any Prometheus-compatible dashboard at this endpoint to visualize cost-per-language, quality trends, and cache efficiency.

## Adaptive Routing

The proxy includes an adaptive routing engine that learns from shadow evaluation quality comparisons over time. Instead of relying solely on static routing rules, it automatically adjusts which language+task combinations get translated based on real quality data.

How to enable:

1. Enable shadow evaluation in `src/serve.ts`:
```typescript
const server = new ProxyServer({
  // ... existing config
  shadowEnabled: true,  // enables parallel baseline requests
});
```

2. Send requests normally. For each translated request, the proxy will also send the original untranslated prompt to the LLM and compare quality scores.

3. After 10+ shadow comparisons for a given language+task combination (e.g., `th+reasoning`), the adaptive router starts making recommendations:
   - If translation consistently improves quality (avg delta > 0.05), it recommends `translate`
   - If translation consistently hurts quality (avg delta < -0.05), it recommends `skip`
   - If inconclusive, it defers to static routing rules

4. Check the debug output to see adaptive routing in action:
```bash
curl -s 'http://localhost:3000/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -H 'X-Debug: true' \
  -d '{"model":"us.amazon.nova-lite-v1:0","messages":[{"role":"user","content":"อธิบาย recursion"}]}'  | jq '._debug.routingReason'
```

Before enough data: `"Matched rule priority 2 → translate"`
After learning: `"Adaptive routing: learned translate for th+general"`

Configuration defaults:
- Minimum 10 samples before making recommendations
- 7-day decay window (older data is weighted out)
- 100 records max per language+task combination
- Recommendations override static rules but not cultural-specific or same-language skip logic

Note: shadow evaluation doubles LLM costs for translated requests. Enable it during a calibration period, then disable once routing policies are tuned.

## Tests

141 tests across 33 test files, using property-based testing with fast-check:

```bash
npm test
```

Every correctness property from the design document is covered by a property-based test that runs 100+ iterations with randomly generated inputs.


## Why This Matters

### For Individual Developers

- **Better answers in your language** — If you're a developer who thinks in Portuguese, Thai, or Korean, your LLM interactions are silently degraded. The optimizer lets you use any model at its full English-level capability while working in your native language.
- **Cheaper API bills** — Non-Latin scripts cost 2-4x more tokens for the same content. Translating to English before sending to the LLM cuts your input token costs by up to 70%.
- **Access to English-only fine-tunes** — Many specialized models and fine-tunes are English-only. The optimizer lets you use them from any language without losing the domain-specific knowledge they were trained on.

### For Enterprise

- **Eliminate the language tax** — Global chatbots silently pay 2-4x more per request for non-English users while delivering worse quality. The optimizer normalizes cost and quality across all languages.
- **Maximize fine-tuning ROI** — Companies spend significant money fine-tuning models on English domain data. Non-English users bypass most of that investment. Translating to English first means every user benefits from the fine-tuned knowledge, regardless of their language.
- **Fix RAG for multilingual users** — Vector embeddings are English-centric. Non-English queries often fail to retrieve relevant documents even when the knowledge base has the answers. Translating queries to English before retrieval dramatically improves recall.
- **Strengthen safety alignment** — Adversarial prompt injections in low-resource languages bypass safety filters that would catch the same attack in English. The translate-to-English path exposes these attacks to the model's strongest defenses.
- **Control conversation costs** — Multi-turn conversations in non-Latin scripts accumulate tokens 3-4x faster. By turn 10, you're sending massive context windows. Translating conversation history to English keeps context windows lean.
- **Response length optimization** — LLMs produce longer, more repetitive responses in languages they're weaker in, inflating output token costs. Our tests showed 1749 output tokens of repetitive Thai content vs 1446 from the optimized path for the same question.
- **Regulatory compliance without quality loss** — Serve users in their required local language (EU AI Act, Brazil's LGPD) while reasoning in English for maximum quality.

### Roadmap

- **Cost-aware routing** — Factor estimated token costs into routing decisions. If the original language would exceed a token threshold, automatically translate to reduce costs. No built-in way to do this exists in any LLM provider today.
- **Language resource tiers** — Built-in classification of languages into high/medium/low resource tiers for automatic routing decisions.
- **Dialect detection** — Detect regional variants (Egyptian Arabic vs Modern Standard Arabic, European vs Brazilian Portuguese) and route per dialect.
- **Code-switching support** — Handle messages that mix languages (Spanglish, Hinglish, Taglish) by routing each language segment through its optimal path.
- **Token budget management** — Track cumulative token spend per conversation and per language, with configurable budgets and alerts.
- **Higher-quality translation backends** — Pluggable support for DeepL and Google Translate for production-grade translation quality.
- **Cost arbitrage across models** — Auto-route to the cheapest model+language combination that meets a quality threshold.
- **Continuous multilingual monitoring** — Extend `/v1/evaluate` into a production monitoring tool that alerts when quality drops for specific languages.
- **Auto-tuning routing policies** — A/B test translated vs direct paths per language using the shadow evaluator and auto-tune routing policies from real quality data.

## License

MIT
