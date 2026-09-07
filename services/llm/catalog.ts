/**
 * Catálogo de modelos con precios verificados el 2026-09-07 en las páginas oficiales:
 *  - https://ai.google.dev/gemini-api/docs/pricing
 *  - https://developers.openai.com/api/docs/pricing
 *  - https://platform.claude.com/docs/en/about-claude/pricing
 * Los precios cambian: revísalos antes de facturar a terceros.
 */
import type { ModelInfo, ProviderId } from './types';

export const MODEL_CATALOG: ModelInfo[] = [
  // ----------------------------- Google Gemini -----------------------------
  {
    id: 'gemini-3.8-flash', provider: 'gemini', label: 'Gemini 3.8 Flash', tag: 'recomendado',
    inputs: { audio: true, image: true },
    pricing: { inputText: 0.75, inputAudio: 0.75, output: 3.75, audioTokensPerSecond: 32, note: 'Precio promocional hasta el 31/12/2026; después 1.50 / 7.50.' },
    notes: 'GA desde el 02/09/2026. Escucha audio de forma nativa (mezclado a mono y remuestreado a 16 kHz).',
  },
  {
    id: 'gemini-3.5-flash-lite', provider: 'gemini', label: 'Gemini 3.5 Flash-Lite', tag: 'mas-barato',
    inputs: { audio: true, image: true },
    pricing: { inputText: 0.30, inputAudio: 0.30, output: 2.50, audioTokensPerSecond: 32 },
    notes: 'La opción más económica con audio nativo. Útil para una primera pasada o consenso múltiple.',
  },
  {
    id: 'gemini-3.1-pro-preview', provider: 'gemini', label: 'Gemini 3.1 Pro (preview)', tag: 'preview',
    inputs: { audio: true, image: true },
    pricing: { inputText: 2.0, inputAudio: 2.0, output: 12.0, audioTokensPerSecond: 32 },
    notes: 'Mayor capacidad de razonamiento, pero en preview (puede cambiar o retirarse).',
  },
  {
    id: 'gemini-2.5-flash', provider: 'gemini', label: 'Gemini 2.5 Flash', tag: 'legado',
    inputs: { audio: true, image: true },
    pricing: { inputText: 0.30, inputAudio: 1.0, output: 2.50, audioTokensPerSecond: 32 },
    notes: 'El modelo original de la app. Sigue disponible; el audio se cobra aparte (1 $/M).',
  },

  // ------------------------------- OpenAI ----------------------------------
  {
    id: 'gpt-audio-mini', provider: 'openai', label: 'GPT Audio Mini', tag: 'recomendado',
    inputs: { audio: true, image: false },
    pricing: { inputText: 0.60, inputAudio: 10.0, output: 2.40, audioTokensPerSecond: 10, note: 'Tokens de audio por segundo tomados de la documentación de Realtime (1 token / 100 ms).' },
    notes: 'Único modelo OpenAI con audio a un precio razonable. Solo Chat Completions; formatos wav/mp3.',
  },
  {
    id: 'gpt-audio-1.5', provider: 'openai', label: 'GPT Audio 1.5', tag: 'mejor-calidad',
    inputs: { audio: true, image: false },
    pricing: { inputText: 2.50, inputAudio: 32.0, output: 10.0, audioTokensPerSecond: 10 },
    notes: 'Modelo de audio actual de OpenAI. ~4× el coste de gpt-audio-mini.',
  },
  {
    id: 'gpt-4o-audio-preview', provider: 'openai', label: 'GPT-4o Audio (preview)', tag: 'legado',
    inputs: { audio: true, image: false },
    pricing: { inputText: 2.50, inputAudio: 40.0, output: 10.0, audioTokensPerSecond: 10 },
    notes: 'Sigue en preview y es el más caro por token de audio.',
  },

  // ------------------------------ Anthropic --------------------------------
  {
    id: 'claude-opus-5', provider: 'anthropic', label: 'Claude Opus 5', tag: 'mejor-calidad',
    inputs: { audio: false, image: true },
    pricing: { inputText: 5.0, output: 25.0 },
    notes: 'No escucha audio: razona sobre el espectrograma + métricas medidas. Mejor juicio y redacción de feedback.',
    maxOutputTokens: 8000,
  },
  {
    id: 'claude-sonnet-5', provider: 'anthropic', label: 'Claude Sonnet 5', tag: 'recomendado',
    inputs: { audio: false, image: true },
    pricing: { inputText: 2.0, output: 10.0 },
    notes: 'Equilibrio calidad/precio para el análisis espectrograma + métricas.',
    maxOutputTokens: 8000,
  },
  {
    id: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku 4.5', tag: 'mas-barato',
    inputs: { audio: false, image: true },
    pricing: { inputText: 1.0, output: 5.0, note: 'Retirada anunciada no antes del 15/10/2026.' },
    notes: 'Barato y rápido; resolución de imagen estándar (1568 px).',
    maxOutputTokens: 8000,
  },
];

export const PROVIDER_LABELS: Record<ProviderId, string> = { gemini: 'Google Gemini', openai: 'OpenAI', anthropic: 'Anthropic Claude' };

export const modelsFor = (provider: ProviderId): ModelInfo[] => MODEL_CATALOG.filter((m) => m.provider === provider);
export const findModel = (id: string): ModelInfo | undefined => MODEL_CATALOG.find((m) => m.id === id);
export const defaultModelFor = (provider: ProviderId): ModelInfo =>
  modelsFor(provider).find((m) => m.tag === 'recomendado') ?? modelsFor(provider)[0];

export interface CostEstimateInput {
  audioSec: number;
  promptTokens?: number; // texto del prompt + métricas
  outputTokens?: number;
  imagePixels?: { width: number; height: number }[]; // imágenes enviadas
  runs?: number;
}

export interface CostEstimate { usd: number; breakdown: { text: number; audio: number; image: number; output: number }; perRunUsd: number }

/** Estimación orientativa del coste de una evaluación (sin cachés ni thinking). */
export const estimateCost = (model: ModelInfo, input: CostEstimateInput): CostEstimate => {
  const promptTokens = input.promptTokens ?? 2500;
  const outputTokens = input.outputTokens ?? 1500;
  const runs = input.runs ?? 1;
  const M = 1e6;
  const text = (promptTokens / M) * model.pricing.inputText;
  const audio = model.inputs.audio && model.pricing.inputAudio !== undefined
    ? ((input.audioSec * (model.pricing.audioTokensPerSecond ?? 32)) / M) * model.pricing.inputAudio
    : 0;
  let imageTokens = 0;
  if (model.inputs.image && input.imagePixels) {
    for (const img of input.imagePixels) {
      // Anthropic: ⌈w/28⌉·⌈h/28⌉; Gemini: ~258 por tile de 768 px; OpenAI no recibe imagen aquí. Aproximamos con la fórmula de Anthropic.
      imageTokens += model.provider === 'gemini' ? Math.ceil(img.width / 768) * Math.ceil(img.height / 768) * 258 : Math.ceil(img.width / 28) * Math.ceil(img.height / 28);
    }
  }
  const image = (imageTokens / M) * model.pricing.inputText;
  const output = (outputTokens / M) * model.pricing.output;
  const perRunUsd = text + audio + image + output;
  return { usd: +(perRunUsd * runs).toFixed(4), perRunUsd: +perRunUsd.toFixed(4), breakdown: { text, audio, image, output } };
};
