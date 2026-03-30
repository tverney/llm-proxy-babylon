# Implementation Plan: Multilingual Prompt Optimizer

## Overview

Implement a TypeScript/Fastify HTTP proxy that intercepts OpenAI-compatible LLM API requests, detects input language, classifies task type, selectively pre-translates prompts to an optimal language, appends a language instruction for the LLM to respond in the original language, and forwards to the target LLM. The implementation follows the pipeline architecture: detect → parse → classify → route → translate + inject language instruction → forward → respond.

## Tasks

- [x] 1. Project setup and core types
  - [x] 1.1 Initialize TypeScript project with Fastify, fast-check, and vitest
    - Create `package.json` with dependencies: fastify, franc, fast-check, vitest, uuid
    - Create `tsconfig.json` with strict mode enabled
    - Create directory structure: `src/`, `src/components/`, `src/models/`, `src/config/`, `src/pipeline/`, `tests/`
    - _Requirements: 13.1_

  - [x] 1.2 Define all core interfaces and data models
    - Create `src/models/types.ts` with all TypeScript interfaces: `DetectedLanguage`, `LanguageDetectionResult`, `Segment`, `SegmentType`, `ParsedContent`, `TaskCategory`, `ClassificationResult`, `RoutingAction`, `RoutingDecision`, `TranslationResult`, `LanguageInstructionConfig`, `LLMRequest`, `LLMResponse`, `QualityScore`, `QualityComparison`, `RequestLog`, `AggregateMetrics`, `LanguageEvaluationResult`, `EvaluationReport`, `PipelineContext`
    - Create `src/models/config.ts` with `ModelProfile`, `LanguagePerformance`, `RoutingPolicyRule`, `RoutingPolicy`, `TranslatorConfig` interfaces
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 8.2, 9.2, 10.1, 11.2, 12.4_

- [x] 2. Language Detector
  - [x] 2.1 Implement LanguageDetector component
    - Create `src/components/language-detector.ts` using the `franc` library
    - Implement `detect(text: string): LanguageDetectionResult` returning BCP-47 tags with confidence scores
    - Implement `setConfidenceThreshold(threshold: number): void` with default 0.7
    - Handle short text (<10 chars) by returning `isUndetermined: true`
    - Handle low confidence (all below threshold) by returning `isUndetermined: true`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 2.2 Write property test: Language detection output validity
    - **Property 1: Language detection output validity**
    - **Validates: Requirements 1.1**

  - [x] 2.3 Write property test: Short text yields undetermined
    - **Property 2: Short text yields undetermined**
    - **Validates: Requirements 1.4**

  - [x] 2.4 Write property test: Low confidence yields undetermined
    - **Property 3: Low confidence yields undetermined**
    - **Validates: Requirements 1.3**

- [x] 3. Mixed Content Parser
  - [x] 3.1 Implement MixedContentParser component
    - Create `src/components/mixed-content-parser.ts`
    - Implement `parse(prompt: string): ParsedContent` that separates text from code blocks, inline code, URLs, JSON, XML, YAML, and SQL segments
    - Implement `translatableSegments()`, `nonTranslatableSegments()`, and `reassemble(translatedTexts)` methods on ParsedContent
    - Use regex patterns to identify segment boundaries and preserve original positions
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.2 Write property test: Mixed content parse-reassemble round trip
    - **Property 4: Mixed content parse-reassemble round trip**
    - **Validates: Requirements 2.2, 2.3, 2.4**

- [x] 4. Content Classifier
  - [x] 4.1 Implement ContentClassifier component
    - Create `src/components/content-classifier.ts`
    - Implement `classify(text: string): ClassificationResult` using keyword/heuristic-based classification
    - Return one or more `TaskCategory` values with confidence scores in [0.0, 1.0]
    - Support categories: reasoning, math, code-generation, creative-writing, translation, summarization, culturally-specific, general
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 4.2 Write property test: Classification output validity
    - **Property 5: Classification output validity**
    - **Validates: Requirements 3.1, 3.2**

- [x] 5. Checkpoint - Core detection and parsing
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Configuration loading and validation
  - [x] 6.1 Implement ModelProfile loader and validator
    - Create `src/config/model-profile-loader.ts`
    - Load ModelProfile configurations from JSON/YAML files
    - Validate required fields: modelId, supportedLanguages, languagePerformance, defaultOptimalLanguage, endpoint
    - Reject invalid configs with descriptive error messages
    - Provide a default ModelProfile for unknown model IDs (translate non-English to English)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 6.2 Write property test: ModelProfile validation
    - **Property 15: ModelProfile validation**
    - **Validates: Requirements 8.2, 8.3**

  - [x] 6.3 Write property test: Unknown model fallback
    - **Property 16: Unknown model fallback**
    - **Validates: Requirements 8.4**

  - [x] 6.4 Implement RoutingPolicy loader and validator
    - Create `src/config/routing-policy-loader.ts`
    - Load RoutingPolicy rules from JSON/YAML files
    - Validate required fields: priority, matchConditions, action
    - Reject configs with duplicate priority numbers
    - Support runtime reload without restart
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 6.5 Write property test: RoutingPolicy validation
    - **Property 17: RoutingPolicy validation**
    - **Validates: Requirements 9.2**

  - [x] 6.6 Write property test: Duplicate priority rejection
    - **Property 18: Duplicate priority rejection**
    - **Validates: Requirements 9.3**

- [x] 7. Routing Engine
  - [x] 7.1 Implement RoutingEngine component
    - Create `src/components/routing-engine.ts`
    - Implement `evaluate(detection, classification, modelProfile): RoutingDecision`
    - Apply same-language skip: if Original_Language matches Optimal_Language, return skip
    - Apply culturally-specific override: if classified as culturally-specific with confidence > 0.8, return skip
    - Evaluate rules in priority order (lowest priority number first), apply first match
    - Default to skip when no rule matches
    - Support hybrid mode: translate system messages, keep user messages in original language
    - Implement `reloadPolicies(policies)` for runtime reload
    - _Requirements: 3.3, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 7.2 Write property test: Culturally-specific override
    - **Property 6: Culturally-specific override**
    - **Validates: Requirements 3.3**

  - [x] 7.3 Write property test: Same-language skip
    - **Property 7: Same-language skip**
    - **Validates: Requirements 4.1**

  - [x] 7.4 Write property test: Priority-ordered rule matching
    - **Property 8: Priority-ordered rule matching**
    - **Validates: Requirements 4.3**

  - [x] 7.5 Write property test: No-match defaults to skip
    - **Property 9: No-match defaults to skip**
    - **Validates: Requirements 4.4**

  - [x] 7.6 Write property test: Hybrid mode translates only system messages
    - **Property 10: Hybrid mode translates only system messages**
    - **Validates: Requirements 4.5**

- [x] 8. Translator with Language Instruction
  - [x] 8.1 Implement Translator component with pluggable backend
    - Create `src/components/translator.ts`
    - Implement `translate(text, from, to): Promise<TranslationResult>` with LibreTranslate as default backend
    - Implement `translateBatch(texts, from, to): Promise<TranslationResult[]>`
    - Implement `buildLanguageInstruction(originalLanguage, config): string` using configurable templates
    - Handle translation failures by returning original text and logging a warning
    - Preserve placeholder tokens during translation
    - _Requirements: 5.1, 5.2, 5.3, 7.1, 7.2, 7.4_

  - [x] 8.2 Write property test: Placeholder preservation during translation
    - **Property 11: Placeholder preservation during translation**
    - **Validates: Requirements 5.2**

  - [x] 8.3 Write property test: Language instruction injection
    - **Property 14: Language instruction injection**
    - **Validates: Requirements 7.1, 7.2**

- [x] 9. Checkpoint - Core pipeline components
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. LLM Forwarder
  - [x] 10.1 Implement LLMForwarder component
    - Create `src/components/llm-forwarder.ts`
    - Implement `forward(request, endpoint): Promise<LLMResponse>` for synchronous requests
    - Implement `forwardStream(request, endpoint): AsyncIterable<unknown>` for streaming responses
    - Propagate LLM error responses with original HTTP status code and error body
    - Pass through all additional request parameters (temperature, top_p, etc.)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 13.4_

  - [x] 10.2 Write property test: LLM error propagation
    - **Property 12: LLM error propagation**
    - **Validates: Requirements 6.3**

- [x] 11. Metrics Collector
  - [x] 11.1 Implement MetricsCollector component
    - Create `src/components/metrics-collector.ts`
    - Implement `log(entry: RequestLog): void` to record per-request data
    - Implement `getMetrics(): AggregateMetrics` computing totals, averages, and percentages
    - Implement `reset(): void`
    - Log warnings when translation latency exceeds configurable threshold (default 2000ms)
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 11.2 Write property test: Request log completeness
    - **Property 19: Request log completeness**
    - **Validates: Requirements 10.1, 11.3**

  - [x] 11.3 Write property test: Aggregate metrics consistency
    - **Property 20: Aggregate metrics consistency**
    - **Validates: Requirements 10.2, 11.5**

  - [x] 11.4 Write property test: Latency threshold warning
    - **Property 21: Latency threshold warning**
    - **Validates: Requirements 10.3**

- [x] 12. Shadow Evaluator
  - [x] 12.1 Implement ShadowEvaluator component
    - Create `src/components/shadow-evaluator.ts`
    - Implement `isEnabled(routingRule): boolean` checking global and per-rule shadow settings
    - Implement `evaluate(originalPrompt, translatedResponse, forwarder, endpoint): Promise<QualityComparison>`
    - Compute quality scores: coherence, completeness, factualConsistency, instructionAdherence, overall
    - Log warning when baseline scores higher than translated by more than configurable threshold (default 0.1)
    - Ensure no extra LLM calls when shadow is disabled
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [x] 12.2 Write property test: Quality score range validity
    - **Property 22: Quality score range validity**
    - **Validates: Requirements 11.2**

  - [x] 12.3 Write property test: Quality degradation warning
    - **Property 23: Quality degradation warning**
    - **Validates: Requirements 11.4**

  - [x] 12.4 Write property test: Shadow disabled means no extra LLM calls
    - **Property 24: Shadow disabled means no extra LLM calls**
    - **Validates: Requirements 11.7**

- [x] 13. Checkpoint - All components implemented
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Pipeline orchestration
  - [x] 14.1 Implement PipelineContext and pipeline orchestrator
    - Create `src/pipeline/pipeline.ts`
    - Wire all components together: detect → parse → classify → route → translate + inject language instruction → forward → respond
    - Build `PipelineContext` object that accumulates results from each stage with timestamps
    - Handle translation fallback: if translator fails, forward original prompt without language instruction
    - Handle skip path: forward original prompt without modification
    - Handle hybrid path: translate system messages only, keep user messages, append language instruction
    - Log metrics via MetricsCollector at pipeline completion
    - Trigger ShadowEvaluator when enabled for the matched routing rule
    - _Requirements: 4.1, 4.5, 5.3, 6.1, 7.1, 7.3, 10.1_

  - [x] 14.2 Write property test: Response passthrough when not translated
    - **Property 13: Response passthrough when not translated**
    - **Validates: Requirements 7.3**

  - [x] 14.3 Write property test: Response structure preservation
    - **Property 25: Response structure preservation**
    - **Validates: Requirements 13.2**

- [x] 15. Proxy server (Fastify HTTP interface)
  - [x] 15.1 Implement ProxyServer with OpenAI-compatible endpoints
    - Create `src/pipeline/proxy-server.ts`
    - Set up Fastify server with `POST /v1/chat/completions` route
    - Validate incoming requests: return HTTP 400 for missing `model` or `messages` fields
    - Support both synchronous and streaming response modes
    - Load ModelProfile and RoutingPolicy configs at startup
    - Wire request handling to the pipeline orchestrator
    - Implement `start(port)` and `stop()` methods
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 15.2 Write property test: Missing fields return 400
    - **Property 26: Missing fields return 400**
    - **Validates: Requirements 13.3**

- [x] 16. Multilingual Evaluation Harness
  - [x] 16.1 Implement MultilingualEvaluator component
    - Create `src/components/multilingual-evaluator.ts`
    - Implement `evaluate(prompt, targetLanguages, modelProfile, forwarder): Promise<EvaluationReport>`
    - Translate prompt into each target language, send each to LLM with language instruction, collect responses
    - Send original English prompt as baseline
    - Compute per-language quality scores and deltaFromBaseline
    - Produce ranking array sorted by overall quality (descending)
    - Implement `evaluateBatch(prompts, targetLanguages, modelProfile, forwarder): Promise<EvaluationReport[]>`
    - Optionally auto-update ModelProfile performance ratings from results
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 16.2 Expose evaluation endpoint on ProxyServer
    - Add `POST /v1/evaluate` route to the Fastify server
    - Accept request body with `prompt`, `targetLanguages`, and optional `modelId`
    - Return structured `EvaluationReport` JSON response
    - Support batch mode with array of prompts
    - _Requirements: 12.1, 12.6_

  - [x] 16.3 Write property test: Evaluation report covers all requested languages
    - **Property 27: Evaluation report covers all requested languages**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.5**

  - [x] 16.4 Write property test: Evaluation quality scores validity
    - **Property 28: Evaluation quality scores validity**
    - **Validates: Requirements 12.4**

  - [x] 16.5 Write property test: Evaluation ranking consistency
    - **Property 29: Evaluation ranking consistency**
    - **Validates: Requirements 12.5**

- [x] 17. Final checkpoint - Full system integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests use fast-check and validate universal correctness properties from the design document
- LibreTranslate is the default translation backend; the Translator interface is pluggable for DeepL/Google/custom backends
- All code examples and implementations use TypeScript
