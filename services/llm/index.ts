import { geminiProvider } from './gemini';
import { openaiProvider } from './openai';
import { anthropicProvider } from './anthropic';
import { openrouterProvider } from './openrouter';
import { aggregateAssessments, type ConsensusResult } from './consensus';
import { estimateCost, findModel } from './catalog';
import { ProviderError, type EvaluationInput, type LLMProvider, type ProviderId, type ProviderResult, type TokenUsage } from './types';

export const PROVIDERS: Record<ProviderId, LLMProvider> = {
  gemini: geminiProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider,
  openrouter: openrouterProvider,
};

export interface RunConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
  /** Número de ejecuciones independientes para el consenso (1, 3 o 5). */
  runs: number;
  temperature?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface AssessmentRun extends ConsensusResult {
  results: ProviderResult[];
  failures: ProviderError[];
  usage: TokenUsage;
  estimatedCostUsd: number;
  elapsedMs: number;
  /** Avisos de los proveedores (p. ej. se consultó sin audio por falta de saldo). */
  warnings: string[];
}

export const runAssessment = async (input: EvaluationInput, cfg: RunConfig): Promise<AssessmentRun> => {
  const provider = PROVIDERS[cfg.provider];
  if (!provider) throw new ProviderError(`Proveedor desconocido: ${cfg.provider}`, cfg.provider, 'bad-request');
  if (!cfg.apiKey.trim()) throw new ProviderError(`Falta la clave de API de ${provider.label}. ${provider.keyHelp}`, cfg.provider, 'auth');
  const runs = Math.max(1, Math.min(5, Math.round(cfg.runs || 1)));
  const t0 = Date.now();
  let done = 0;

  const settled = await Promise.allSettled(
    Array.from({ length: runs }, () =>
      provider.evaluate(input, { model: cfg.model, apiKey: cfg.apiKey, temperature: cfg.temperature, signal: cfg.signal }).finally(() => cfg.onProgress?.(++done, runs)),
    ),
  );
  const results = settled.filter((s): s is PromiseFulfilledResult<ProviderResult> => s.status === 'fulfilled').map((s) => s.value);
  const failures = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected').map((s) => (s.reason instanceof ProviderError ? s.reason : new ProviderError(String(s.reason?.message ?? s.reason), cfg.provider, 'unknown', s.reason)));
  if (results.length === 0) throw failures[0] ?? new ProviderError('Ninguna ejecución devolvió resultado.', cfg.provider, 'unknown');

  const consensus = aggregateAssessments(results.map((r) => r.assessment));
  const usage = results.reduce<TokenUsage>(
    (acc, r) => ({
      inputTokens: acc.inputTokens + (r.usage?.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (r.usage?.outputTokens ?? 0),
      audioTokens: (acc.audioTokens ?? 0) + (r.usage?.audioTokens ?? 0),
      imageTokens: (acc.imageTokens ?? 0) + (r.usage?.imageTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, audioTokens: 0, imageTokens: 0 },
  );

  // Coste: real si tenemos tokens, estimado si no
  const model = findModel(cfg.model);
  let estimatedCostUsd = 0;
  if (model) {
    if (usage.inputTokens > 0) {
      const audioTok = usage.audioTokens ?? 0;
      const textTok = Math.max(0, usage.inputTokens - audioTok);
      estimatedCostUsd = (textTok / 1e6) * model.pricing.inputText + (audioTok / 1e6) * (model.pricing.inputAudio ?? model.pricing.inputText) + (usage.outputTokens / 1e6) * model.pricing.output;
    } else {
      estimatedCostUsd = estimateCost(model, { audioSec: input.features.format.duration, runs: results.length, imagePixels: input.spectrogram ? [{ width: input.spectrogram.width, height: input.spectrogram.height }] : [] }).usd;
    }
  }

  const warnings = [...new Set(results.flatMap((r) => r.warnings ?? []))];
  return { ...consensus, results, failures, usage, estimatedCostUsd: +estimatedCostUsd.toFixed(4), elapsedMs: Date.now() - t0, warnings };
};

export { aggregateAssessments } from './consensus';
export * from './catalog';
export * from './types';
export type { CreativeAssessment, ToolAssessment } from './schema';
export { extractJson } from './json';
