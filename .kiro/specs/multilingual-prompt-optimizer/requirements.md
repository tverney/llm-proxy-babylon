# Requirements Document

## Introduction

The Multilingual Prompt Optimizer is a middleware/proxy framework that sits between users and LLM APIs to improve multilingual performance. Research shows LLMs perform 5-8% worse on non-English inputs for many task types. This framework detects the input language, decides whether translating to an optimal language (typically English) would improve results based on task type and model capabilities, and performs selective pre-translation before calling the target LLM. Rather than performing a separate response translation step, the framework appends a language instruction to the translated prompt (e.g., "Please respond in Portuguese") so the LLM produces its response directly in the user's original language. This leverages the fact that LLMs have no difficulty generating output in a specified language — the performance gap is in *understanding* non-English prompts, not in *producing* non-English responses. The goal is a lightweight, configurable proxy that applies "selective pre-translation" — a validated technique — to production workloads without requiring changes to upstream LLM APIs or downstream client code.

## Glossary

- **Optimizer**: The core middleware/proxy framework that intercepts prompts, applies optimization decisions, and returns responses
- **Language_Detector**: The component responsible for identifying the language of incoming prompt text
- **Routing_Engine**: The component that decides whether a prompt should be translated before LLM inference, and to which target language
- **Translator**: The component responsible for translating text between languages
- **Content_Classifier**: The component that identifies the task type (reasoning, math, creative writing, culturally-specific, etc.) of a prompt
- **Mixed_Content_Parser**: The component that separates translatable prompt instruction segments from non-translatable segments (code snippets, URLs, structured data, and file attachments) within a prompt
- **Prompt_Text**: The user's semantic instruction or question text within a message — the part that expresses intent and is eligible for translation. Excludes any attached file content, image references, or embedded data.
- **Attached_Content**: Any non-instruction content included in a message, such as file attachments (PDFs, documents), images, base64-encoded data, image_url references, or multipart content. Attached_Content is never translated.
- **Model_Profile**: A configuration object describing a specific LLM's multilingual capabilities, including per-language performance characteristics
- **Routing_Policy**: A set of rules combining task type, source language, and model profile to determine whether translation is beneficial
- **Original_Language**: The language detected in the user's incoming prompt
- **Optimal_Language**: The language determined by the Routing_Engine to yield the best LLM performance for a given task and model combination
- **Language_Instruction**: A directive appended to the translated prompt instructing the LLM to respond in the Original_Language (e.g., "Please respond in Portuguese")
- **Multilingual_Evaluator**: A component that takes a single prompt, fans it out across multiple languages, runs each variant through the LLM, and compares response quality to measure per-language performance
- **Round_Trip**: The full cycle of translating a prompt to the optimal language, appending a Language_Instruction, and obtaining an LLM response in the Original_Language

## Requirements

### Requirement 1: Language Detection

**User Story:** As a developer integrating the Optimizer into my application, I want incoming prompts to be automatically analyzed for language, so that the framework can make informed routing decisions.

#### Acceptance Criteria

1. WHEN a prompt is received, THE Language_Detector SHALL identify the primary language of the prompt and return a BCP-47 language tag with a confidence score between 0.0 and 1.0
2. WHEN a prompt contains text in multiple natural languages, THE Language_Detector SHALL identify all detected languages and their respective confidence scores
3. IF the Language_Detector confidence score for all detected languages is below a configurable threshold (default 0.7), THEN THE Language_Detector SHALL label the language as "undetermined" and pass the prompt through without translation
4. WHEN a prompt contains fewer than 10 characters of natural language text, THE Language_Detector SHALL label the language as "undetermined"

### Requirement 2: Mixed Content Parsing

**User Story:** As a developer, I want code snippets, URLs, structured data, and file attachments within prompts to be preserved exactly as-is during translation, so that technical content and attached files are not corrupted.

#### Acceptance Criteria

1. WHEN a prompt is received, THE Mixed_Content_Parser SHALL separate the prompt into translatable Prompt_Text segments and non-translatable segments (code blocks, inline code, URLs, JSON, XML, YAML, SQL, and Attached_Content)
2. THE Mixed_Content_Parser SHALL preserve the original ordering and relative positions of all segments after reassembly
3. WHEN the Translator translates Prompt_Text segments, THE Optimizer SHALL reassemble the full prompt by reinserting non-translatable segments in their original positions
4. FOR ALL prompts containing mixed content, parsing then reassembling without translation SHALL produce output identical to the original prompt (round-trip property)
5. WHEN a prompt includes Attached_Content such as PDF files, images, base64-encoded data, or document references, THE Mixed_Content_Parser SHALL classify the Attached_Content as non-translatable and pass it through without modification
6. THE Mixed_Content_Parser SHALL translate only the Prompt_Text (the user's semantic instruction or question) and leave all Attached_Content intact

### Requirement 3: Task Classification

**User Story:** As a developer, I want the framework to identify the type of task a prompt represents, so that translation decisions can be tailored to task characteristics.

#### Acceptance Criteria

1. WHEN a prompt is received, THE Content_Classifier SHALL classify the prompt into one or more task categories: reasoning, math, code-generation, creative-writing, translation, summarization, culturally-specific, or general
2. THE Content_Classifier SHALL return a confidence score between 0.0 and 1.0 for each assigned category
3. WHEN a prompt is classified as "culturally-specific" with a confidence score above 0.8, THE Routing_Engine SHALL keep the prompt in the Original_Language regardless of other routing rules

### Requirement 4: Smart Routing Decisions

**User Story:** As a developer, I want the framework to decide intelligently whether translating a prompt will improve LLM output quality, so that translation is only applied when beneficial.

#### Acceptance Criteria

1. WHEN a prompt's Original_Language matches the Optimal_Language for the given Model_Profile and task type, THE Routing_Engine SHALL skip translation and forward the prompt directly to the target LLM
2. WHEN the Routing_Engine determines that translation is beneficial, THE Routing_Engine SHALL select the Optimal_Language based on the combination of task type, Original_Language, and Model_Profile
3. THE Routing_Engine SHALL evaluate each Routing_Policy rule in priority order and apply the first matching rule
4. WHEN no Routing_Policy rule matches, THE Routing_Engine SHALL default to passing the prompt through without translation
5. WHERE a hybrid routing mode is enabled, THE Routing_Engine SHALL translate system prompts and chain-of-thought instructions to the Optimal_Language while keeping user-provided content in the Original_Language

### Requirement 5: Prompt Translation

**User Story:** As a developer, I want only the user's prompt instructions to be translated to the optimal language before LLM inference, so that the LLM produces higher-quality responses while attached file content remains untouched.

#### Acceptance Criteria

1. WHEN the Routing_Engine decides to translate, THE Translator SHALL translate only the Prompt_Text segments identified by the Mixed_Content_Parser from the Original_Language to the Optimal_Language
2. THE Translator SHALL preserve all placeholder tokens inserted by the Mixed_Content_Parser during translation
3. IF the Translator fails to translate a prompt, THEN THE Optimizer SHALL forward the original untranslated prompt to the target LLM and log a warning
4. THE Translator SHALL not translate any Attached_Content, including file contents, image data, base64-encoded payloads, or document references, regardless of the language they contain

### Requirement 6: LLM API Forwarding

**User Story:** As a developer, I want the framework to forward optimized prompts to any target LLM API, so that I can use the optimizer with different LLM providers.

#### Acceptance Criteria

1. THE Optimizer SHALL forward the optimized prompt to the configured target LLM API endpoint and return the LLM response
2. THE Optimizer SHALL support configurable target LLM endpoints via the Model_Profile configuration
3. WHEN the target LLM API returns an error, THE Optimizer SHALL propagate the error response to the caller with the original error code and message intact
4. THE Optimizer SHALL add no more than the translation overhead to the total request latency (excluding LLM inference time)

### Requirement 7: Language Instruction Injection

**User Story:** As a developer, I want the LLM to respond directly in the user's original language without a separate translation step, so that the system avoids the latency, cost, and potential errors of back-translation.

#### Acceptance Criteria

1. WHEN the Routing_Engine decides to translate a prompt, THE Optimizer SHALL append a Language_Instruction to the translated prompt directing the LLM to respond in the Original_Language (e.g., "Please respond in Portuguese since the original question was asked in Portuguese")
2. THE Language_Instruction SHALL be appended as a system message or appended to the last user message, configurable via the Routing_Policy
3. WHEN the Routing_Engine did not translate the prompt, THE Optimizer SHALL forward the prompt and return the LLM response without any modification
4. THE Language_Instruction template SHALL be configurable, allowing developers to customize the phrasing per language or globally

### Requirement 8: Model Profile Configuration

**User Story:** As a developer, I want to configure per-model multilingual capability profiles, so that routing decisions reflect the actual strengths and weaknesses of each LLM.

#### Acceptance Criteria

1. THE Optimizer SHALL load Model_Profile configurations from a configuration file (JSON or YAML format)
2. WHEN a Model_Profile is loaded, THE Optimizer SHALL validate that the profile contains: model identifier, supported languages, per-language performance ratings, and a default Optimal_Language
3. IF a Model_Profile configuration is missing or invalid, THEN THE Optimizer SHALL reject the configuration at startup and report a descriptive error message
4. WHEN a request specifies a model identifier not found in any loaded Model_Profile, THE Optimizer SHALL use a default Model_Profile that routes all non-English prompts through English translation

### Requirement 9: Routing Policy Configuration

**User Story:** As a developer, I want to define custom routing policies, so that I can control when and how translation is applied for different scenarios.

#### Acceptance Criteria

1. THE Optimizer SHALL load Routing_Policy rules from a configuration file (JSON or YAML format)
2. WHEN a Routing_Policy is loaded, THE Optimizer SHALL validate that each rule contains: a priority number, match conditions (task type, source language pattern, model identifier pattern), and an action (translate, skip, or hybrid)
3. IF a Routing_Policy configuration contains duplicate priority numbers, THEN THE Optimizer SHALL reject the configuration and report the conflicting priorities
4. THE Optimizer SHALL support reloading Routing_Policy configurations at runtime without restarting the service

### Requirement 10: Observability and Metrics

**User Story:** As a developer operating the framework in production, I want visibility into optimization decisions and translation performance, so that I can monitor and tune the system.

#### Acceptance Criteria

1. THE Optimizer SHALL log each request with: request identifier, detected language, detected task type, routing decision (translate/skip/hybrid), target language, and total translation latency
2. THE Optimizer SHALL expose metrics for: total requests processed, requests translated, requests skipped, translation error count, and average translation latency
3. WHEN a Round_Trip translation adds more than a configurable latency threshold (default 2000ms) to a request, THE Optimizer SHALL log a warning with the request identifier and measured latency

### Requirement 11: Response Quality Evaluation

**User Story:** As a developer, I want the framework to evaluate whether the translated prompt produced a better LLM response than the original language would have, so that I can measure the actual benefit of translation and tune routing decisions over time.

#### Acceptance Criteria

1. WHEN a prompt is translated before LLM inference, THE Optimizer SHALL optionally perform a parallel "shadow" request using the original untranslated prompt to the same LLM, producing a baseline response for comparison
2. THE Optimizer SHALL compute a quality comparison score between the translated-path response and the baseline response using configurable evaluation criteria (coherence, completeness, factual consistency, and instruction adherence)
3. THE Optimizer SHALL log the quality comparison results alongside the request metrics, including: request identifier, translated response score, baseline response score, and the score delta
4. WHEN the baseline response scores higher than the translated response by more than a configurable threshold (default 0.1), THE Optimizer SHALL log a warning indicating that translation may have degraded quality for that request
5. THE Optimizer SHALL expose aggregate quality metrics: average score delta across translated requests, percentage of requests where translation improved quality, and percentage where it degraded quality
6. THE Optimizer SHALL support enabling or disabling shadow evaluation globally or per Routing_Policy rule, to control the additional cost and latency of dual LLM calls
7. WHEN shadow evaluation is disabled, THE Optimizer SHALL not make any additional LLM calls beyond the primary optimized request

### Requirement 12: Multilingual Evaluation Harness

**User Story:** As a developer, I want to evaluate an LLM's response quality across multiple languages for a given prompt, so that I can benchmark multilingual performance, validate routing policies, and populate Model_Profile performance ratings with real data.

#### Acceptance Criteria

1. THE Optimizer SHALL expose an evaluation endpoint that accepts a single prompt and a list of target languages to evaluate
2. WHEN an evaluation request is received, THE Multilingual_Evaluator SHALL translate the prompt into each specified target language using the Translator, send each translated variant to the target LLM (with a Language_Instruction to respond in that language), and collect all responses
3. THE Multilingual_Evaluator SHALL also send the original English prompt to the LLM as a baseline
4. THE Multilingual_Evaluator SHALL compute a quality score for each language response using the same evaluation criteria as the Response Quality Evaluation (coherence, completeness, factual consistency, and instruction adherence), and return a per-language comparison report
5. THE Multilingual_Evaluator SHALL return a structured report containing: the original prompt, each language tested, the quality scores per language, the delta from the English baseline, and a ranking of languages by quality
6. THE Multilingual_Evaluator SHALL support batch evaluation, accepting multiple prompts in a single request and returning per-prompt per-language results
7. THE Optimizer SHALL optionally use evaluation results to auto-update per-language performance ratings in the Model_Profile, when configured to do so

### Requirement 13: Proxy Interface

**User Story:** As a developer, I want the framework to expose an HTTP API compatible with common LLM API formats, so that I can integrate it as a drop-in proxy with minimal client changes.

#### Acceptance Criteria

1. THE Optimizer SHALL expose an HTTP endpoint that accepts requests in OpenAI-compatible chat completion format
2. THE Optimizer SHALL return responses in the same format as the target LLM API, with no structural modifications beyond translated content
3. WHEN a request is missing required fields, THE Optimizer SHALL return an HTTP 400 response with a descriptive error message
4. THE Optimizer SHALL support both synchronous and streaming response modes as provided by the target LLM API

### Requirement 14: Multipart Message Content Handling

**User Story:** As a developer, I want the framework to correctly handle OpenAI-compatible messages that contain content arrays with mixed text and file/image parts, so that only the user's prompt instructions are translated while file and image references are passed through untouched.

#### Acceptance Criteria

1. WHEN a message contains a content array with multiple parts (text, image_url, or other types), THE Mixed_Content_Parser SHALL identify and extract only the text parts that represent the user's Prompt_Text for translation
2. WHEN a message content array includes image_url parts, THE Mixed_Content_Parser SHALL classify the image_url parts as Attached_Content and pass them through without modification
3. WHEN a message content array includes base64-encoded image data or file references, THE Mixed_Content_Parser SHALL classify the encoded data as Attached_Content and pass it through without modification
4. THE Mixed_Content_Parser SHALL reassemble the content array after translation, preserving the original order and structure of all parts (both translated text parts and untouched Attached_Content parts)
5. WHEN a message content field is a plain string (not an array), THE Mixed_Content_Parser SHALL treat the entire string as Prompt_Text eligible for translation, subject to existing mixed content parsing rules
