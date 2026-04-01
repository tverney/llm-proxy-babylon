import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import type { LLMRequest } from '../models/types.ts';
import type { ModelProfile, RoutingPolicy, TranslatorConfig } from '../models/config.ts';
import { formatCostUSD, formatModelPricing, getModelCostTier } from '../config/model-costs.ts';
import { Pipeline } from './pipeline.ts';
import { LanguageDetector } from '../components/language-detector.ts';
import { MixedContentParser } from '../components/mixed-content-parser.ts';
import { ContentClassifier } from '../components/content-classifier.ts';
import { RoutingEngine } from '../components/routing-engine.ts';
import { Translator } from '../components/translator.ts';
import { LLMForwarder } from '../components/llm-forwarder.ts';
import { MetricsCollector } from '../components/metrics-collector.ts';
import { ShadowEvaluator } from '../components/shadow-evaluator.ts';
import { ModelProfileRegistry } from '../config/model-profile-loader.ts';
import { MultilingualEvaluator } from '../components/multilingual-evaluator.ts';
import { PrometheusExporter } from '../components/prometheus-exporter.ts';

export interface ProxyServerConfig {
  modelProfiles: ModelProfile[];
  routingPolicy: RoutingPolicy;
  translatorConfig: TranslatorConfig;
  shadowEnabled?: boolean;
  latencyThresholdMs?: number;
}

export class ProxyServer {
  private app: FastifyInstance;
  private pipeline: Pipeline;
  private forwarder: LLMForwarder;
  private profileRegistry: ModelProfileRegistry;
  private evaluator: MultilingualEvaluator;
  private prometheus: PrometheusExporter;

  constructor(config: ProxyServerConfig) {
    this.app = Fastify({ logger: false });

    const detector = new LanguageDetector();
    const parser = new MixedContentParser();
    const classifier = new ContentClassifier();
    const routingEngine = new RoutingEngine(config.routingPolicy);
    const translator = new Translator(config.translatorConfig);
    this.forwarder = new LLMForwarder();
    const metrics = new MetricsCollector(config.latencyThresholdMs);
    const shadowEvaluator = new ShadowEvaluator({ enabled: config.shadowEnabled ?? false });
    this.profileRegistry = new ModelProfileRegistry(config.modelProfiles);

    this.evaluator = new MultilingualEvaluator({
      translatorConfig: config.translatorConfig,
    });

    this.prometheus = new PrometheusExporter();

    this.pipeline = new Pipeline({
      detector,
      parser,
      classifier,
      routingEngine,
      translator,
      forwarder: this.forwarder,
      metrics,
      shadowEvaluator,
      profileRegistry: this.profileRegistry,
    });

    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.registerChatCompletionsRoute();
    this.registerEvaluateRoute();
    this.registerMetricsRoute();
  }

  private registerChatCompletionsRoute(): void {
    this.app.post('/v1/chat/completions', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown> | null | undefined;

      // Validate required fields (Req 13.3)
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: { message: 'Request body must be a JSON object' } });
      }
      if (!body.model || typeof body.model !== 'string') {
        return reply.status(400).send({ error: { message: 'Missing required field: model' } });
      }
      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return reply.status(400).send({ error: { message: 'Missing required field: messages' } });
      }

      const llmRequest = body as unknown as LLMRequest;

      // Extract auth headers to pass through to the upstream LLM
      const upstreamHeaders: Record<string, string> = {};
      const authHeader = request.headers['authorization'];
      if (authHeader) {
        upstreamHeaders['Authorization'] = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      }

      // Extract conversation ID for translation caching
      const convHeader = request.headers['x-conversation-id'];
      const conversationId = convHeader
        ? (Array.isArray(convHeader) ? convHeader[0] : convHeader)
        : undefined;

      // Streaming mode (Req 13.4)
      if (llmRequest.stream) {
        return this.handleStream(llmRequest, reply, upstreamHeaders, conversationId);
      }

      // Synchronous mode
      try {
        const { response, context } = await this.pipeline.process(llmRequest, upstreamHeaders, conversationId);

        // Record prometheus metrics
        this.prometheus.record({
          requestId: context.requestId,
          detectedLanguage: context.detection.primary.tag,
          taskType: context.classification.primaryCategory,
          routingDecision: context.routingDecision.action,
          targetLanguage: context.routingDecision.optimalLanguage,
          translationLatencyMs: context.timestamps.translationDone
            ? context.timestamps.translationDone - context.timestamps.routingDone : 0,
          totalLatencyMs: context.timestamps.completed - context.timestamps.received,
          promptTokens: context.tokenUsage?.promptTokens,
          savedTokens: context.tokenSavings?.tokensSaved,
          cacheHits: context.translationCacheHits,
          cacheMisses: context.translationCacheMisses,
        });

        // Debug mode: include pipeline context when X-Debug header is present
        const debug = request.headers['x-debug'] === 'true';
        if (debug) {
          // If the prompt was translated, also call the LLM with the original untranslated prompt
          let baselineResponse: Record<string, unknown> | null = null;
          if (context.routingDecision.action !== 'skip') {
            try {
              const baseline = await this.forwarder.forward(
                llmRequest,
                context.modelProfile.endpoint,
                upstreamHeaders,
                context.modelProfile.provider,
                context.modelProfile.awsRegion,
              );
              baselineResponse = {
                content: baseline.content,
                raw: baseline.raw,
              };
            } catch {
              baselineResponse = { error: 'Baseline call failed' };
            }
          }

          const debugPayload = {
            ...response.raw as object,
            _debug: {
              requestId: context.requestId,
              normalization: context.normalization ?? null,
              detectedLanguage: context.detection.primary.tag,
              detectedConfidence: context.detection.primary.confidence,
              allDetectedLanguages: context.detection.all.map(l => ({ tag: l.tag, confidence: l.confidence })),
              isUndetermined: context.detection.isUndetermined,
              taskType: context.classification.primaryCategory,
              routingDecision: context.routingDecision.action,
              routingReason: context.routingDecision.reason,
              routingTrace: this.pipeline.getLastRoutingTrace(),
              optimalLanguage: context.routingDecision.optimalLanguage,
              translatedPrompt: context.translatedPrompt ?? null,
              languageInstruction: context.languageInstruction ?? null,
              baselineResponse,
              tokenUsage: context.tokenUsage ?? null,
              tokenSavings: context.tokenSavings ?? null,
              costEstimate: context.costEstimate ? {
                ...context.costEstimate,
                formatted: {
                  input: formatCostUSD(context.costEstimate.inputCostUSD),
                  output: formatCostUSD(context.costEstimate.outputCostUSD),
                  total: formatCostUSD(context.costEstimate.totalCostUSD),
                  saved: formatCostUSD(context.costEstimate.savedInputCostUSD),
                  modelPricing: formatModelPricing(getModelCostTier(llmRequest.model)),
                },
              } : null,
              conversationCache: conversationId ? {
                conversationId,
                cacheHits: context.translationCacheHits ?? 0,
                cacheMisses: context.translationCacheMisses ?? 0,
              } : null,
              responseTranslation: context.responseTranslation ?? null,
              timestamps: {
                totalMs: context.timestamps.completed - context.timestamps.received,
                detectionMs: context.timestamps.detectionDone - context.timestamps.received,
                classificationMs: context.timestamps.classificationDone - context.timestamps.parsingDone,
                translationMs: context.timestamps.translationDone
                  ? context.timestamps.translationDone - context.timestamps.routingDone
                  : 0,
                llmMs: context.timestamps.llmResponseReceived - (context.timestamps.translationDone ?? context.timestamps.routingDone),
                responseTranslationMs: context.timestamps.responseTranslationDone
                  ? context.timestamps.responseTranslationDone - context.timestamps.llmResponseReceived
                  : 0,
              },
            },
          };
          return reply.status(response.statusCode).send(debugPayload);
        }

        // Propagate LLM error status codes (Req 6.3)
        return reply.status(response.statusCode).send(response.raw);
      } catch (err) {
        this.prometheus.recordError();
        return reply.status(502).send({
          error: { message: `Pipeline error: ${err instanceof Error ? err.message : String(err)}` },
        });
      }
    });
  }

  private registerEvaluateRoute(): void {
    this.app.post('/v1/evaluate', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown> | null | undefined;

      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: { message: 'Request body must be a JSON object' } });
      }

      // Validate targetLanguages
      if (!Array.isArray(body.targetLanguages) || body.targetLanguages.length === 0) {
        return reply.status(400).send({ error: { message: 'Missing required field: targetLanguages must be a non-empty array of language codes' } });
      }
      for (const lang of body.targetLanguages) {
        if (typeof lang !== 'string' || lang.trim() === '') {
          return reply.status(400).send({ error: { message: 'Each entry in targetLanguages must be a non-empty string' } });
        }
      }

      const targetLanguages = body.targetLanguages as string[];

      // Validate that either prompt or prompts is provided
      const hasPrompt = typeof body.prompt === 'string' && body.prompt.trim() !== '';
      const hasPrompts = Array.isArray(body.prompts) && body.prompts.length > 0;

      if (!hasPrompt && !hasPrompts) {
        return reply.status(400).send({ error: { message: 'Missing required field: provide either "prompt" (string) or "prompts" (non-empty array of strings)' } });
      }

      // Resolve model profile
      const modelId = typeof body.modelId === 'string' ? body.modelId : undefined;
      const modelProfile = modelId
        ? this.profileRegistry.get(modelId)
        : this.profileRegistry.all()[0] ?? this.profileRegistry.get('__default__');

      try {
        if (hasPrompts) {
          // Batch mode: validate all entries are non-empty strings
          const prompts = body.prompts as unknown[];
          for (const p of prompts) {
            if (typeof p !== 'string' || p.trim() === '') {
              return reply.status(400).send({ error: { message: 'Each entry in prompts must be a non-empty string' } });
            }
          }
          const reports = await this.evaluator.evaluateBatch(
            prompts as string[],
            targetLanguages,
            modelProfile,
            this.forwarder,
          );
          return reply.status(200).send(reports);
        }

        // Single prompt mode
        const report = await this.evaluator.evaluate(
          body.prompt as string,
          targetLanguages,
          modelProfile,
          this.forwarder,
        );
        return reply.status(200).send(report);
      } catch (err) {
        return reply.status(502).send({
          error: { message: `Evaluation error: ${err instanceof Error ? err.message : String(err)}` },
        });
      }
    });
  }

  private async handleStream(request: LLMRequest, reply: FastifyReply, upstreamHeaders?: Record<string, string>, conversationId?: string): Promise<void> {
    try {
      // Run the pipeline up to translation, then stream the LLM response
      const { preparedRequest, context } = await this.pipeline.prepare(request, conversationId);

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const streamRequest = { ...preparedRequest, stream: true };
      for await (const chunk of this.forwarder.forwardStream(
        streamRequest,
        context.modelProfile.endpoint,
        upstreamHeaders,
        context.modelProfile.provider,
        context.modelProfile.awsRegion,
      )) {
        const data = typeof chunk === 'string' ? chunk : JSON.stringify(chunk);
        reply.raw.write(`data: ${data}\n\n`);
      }

      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
    } catch (err) {
      if (!reply.raw.headersSent) {
        reply.status(502).send({
          error: { message: `Pipeline error: ${err instanceof Error ? err.message : String(err)}` },
        });
      } else {
        reply.raw.end();
      }
    }
  }

  async start(port: number): Promise<void> {
    await this.app.listen({ port, host: '0.0.0.0' });
  }

  async stop(): Promise<void> {
    await this.app.close();
  }

  private registerMetricsRoute(): void {
    this.app.get('/v1/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      return reply.send(this.prometheus.export());
    });
  }

  /** Expose the underlying Fastify instance for testing */
  getApp(): FastifyInstance {
    return this.app;
  }
}
