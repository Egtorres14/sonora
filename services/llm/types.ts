import type { AudioFeatures } from '../audio/features';
import type { RubricConfig } from '../scoring/rubric';
import type { CreativeAssessment } from './schema';

export type ProviderId = 'gemini' | 'openai' | 'anthropic';

export interface ModelPricing {
  /** USD por millón de tokens de texto de entrada */
  inputText: number;
  /** USD por millón de tokens de AUDIO de entrada (si el modelo escucha audio) */
  inputAudio?: number;
  /** USD por millón de tokens de salida */
  output: number;
  /** Tokens que consume un segundo de audio (Gemini 32, OpenAI ≈10) */
  audioTokensPerSecond?: number;
  /** Nota sobre la vigencia del precio (promociones, cambios anunciados) */
  note?: string;
}

export interface ModelInfo {
  id: string;
  provider: ProviderId;
  label: string;
  /** Qué puede recibir el modelo */
  inputs: { audio: boolean; image: boolean };
  pricing: ModelPricing;
  tag?: 'recomendado' | 'mejor-calidad' | 'mas-barato' | 'legado' | 'preview';
  notes?: string;
  /** Recorte de contexto: tokens máximos de salida que pediremos */
  maxOutputTokens?: number;
}

/** Audio preparado para el modelo (mezcla mono 16 kHz PCM16 → pequeño y equivalente a lo que el modelo procesa). */
export interface ModelAudio {
  base64: string;
  mimeType: 'audio/wav' | 'audio/mpeg';
  sampleRate: number;
  channels: number;
  durationSec: number;
  bytes: number;
}

export interface ModelImage {
  base64: string; // PNG sin prefijo data:
  mimeType: 'image/png';
  width: number;
  height: number;
  description: string; // qué representa (ejes, escala) para el prompt
}

export interface EvaluationInput {
  fileName: string;
  synopsis: string;
  context: string;
  features: AudioFeatures;
  rubric: RubricConfig;
  audio?: ModelAudio;
  spectrogram?: ModelImage;
  waveform?: ModelImage;
}

export interface EvaluateOptions {
  model: string;
  apiKey: string;
  temperature?: number;
  signal?: AbortSignal;
}

export interface TokenUsage { inputTokens: number; outputTokens: number; audioTokens?: number; imageTokens?: number }

export interface ProviderResult {
  assessment: CreativeAssessment;
  usage?: TokenUsage;
  raw?: unknown;
  model: string;
  provider: ProviderId;
  elapsedMs: number;
}

export interface LLMProvider {
  id: ProviderId;
  label: string;
  /** Mensaje de ayuda para obtener la clave */
  keyHelp: string;
  evaluate(input: EvaluationInput, opts: EvaluateOptions): Promise<ProviderResult>;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly provider: ProviderId, public readonly kind: 'auth' | 'quota' | 'bad-request' | 'server' | 'network' | 'refusal' | 'parse' | 'unknown', public readonly cause?: unknown) {
    super(message);
    this.name = 'ProviderError';
  }
}
