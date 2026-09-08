/**
 * OpenRouter: un único endpoint compatible con OpenAI que enruta a modelos de Google, OpenAI, NVIDIA…
 *  - Audio como `input_audio` (wav base64); espectrograma como `image_url` (data URI).
 *  - JSON estricto (`response_format: json_schema`) solo en modelos con `structuredOutput`; en el resto se pide
 *    JSON en el prompt y se extrae del texto (los modelos gratuitos razonan antes de responder).
 *  - OpenRouter exige al menos 0,50 $ de saldo para enviar audio, incluso a modelos gratuitos: si falla por eso,
 *    se reintenta sin audio (espectrograma + métricas) y se deja constancia en `warnings`.
 */
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { buildPrompt } from './prompt';
import { CreativeAssessmentSchema, normalizeAssessment, toCleanJsonSchema } from './schema';
import { findModel } from './catalog';
import { extractJson } from './json';
import { ProviderError, type EvaluateOptions, type EvaluationInput, type JsonRequest, type JsonResult, type LLMProvider, type ProviderResult, type TokenUsage } from './types';

const BASE_URL = 'https://openrouter.ai/api/v1';
const APP_HEADERS = { 'HTTP-Referer': 'https://egtorres14.github.io/sonora/', 'X-Title': 'Sonora · Laboratorio de audio' };
export const AUDIO_BALANCE_WARNING = 'OpenRouter exige al menos 0,50 $ de saldo para enviar audio; se consultó sin audio, con espectrograma y métricas.';

const client = (apiKey: string) => new OpenAI({ apiKey, baseURL: BASE_URL, defaultHeaders: APP_HEADERS, dangerouslyAllowBrowser: true });

const mapError = (error: unknown): ProviderError => {
  if (error instanceof ProviderError) return error;
  if (error instanceof OpenAI.AuthenticationError) return new ProviderError('Clave de API de OpenRouter no válida.', 'openrouter', 'auth', error);
  if (error instanceof OpenAI.RateLimitError) return new ProviderError('Límite de peticiones de OpenRouter alcanzado (los modelos gratuitos tienen cupo diario). Espera un momento.', 'openrouter', 'quota', error);
  if (error instanceof OpenAI.APIError && error.status === 402) return new ProviderError(`OpenRouter necesita saldo para esta petición: ${error.message.slice(0, 160)} Añade crédito en https://openrouter.ai/settings/credits.`, 'openrouter', 'quota', error);
  if (error instanceof OpenAI.APIError && error.status === 403) return new ProviderError(`OpenRouter no permite este modelo desde la app: ${error.message.slice(0, 200)}`, 'openrouter', 'bad-request', error);
  if (error instanceof OpenAI.BadRequestError) return new ProviderError(`OpenRouter rechazó la petición: ${error.message}`, 'openrouter', 'bad-request', error);
  if (error instanceof OpenAI.APIConnectionError) return new ProviderError('No se pudo conectar con OpenRouter (red o CORS).', 'openrouter', 'network', error);
  if (error instanceof OpenAI.APIError) return new ProviderError(`Error de OpenRouter (${error.status}): ${error.message}`, 'openrouter', (error.status ?? 0) >= 500 ? 'server' : 'unknown', error);
  if (error instanceof Error && error.name === 'AbortError') return new ProviderError('Evaluación cancelada.', 'openrouter', 'unknown', error);
  return new ProviderError(error instanceof Error ? error.message : 'Error desconocido de OpenRouter.', 'openrouter', 'unknown', error);
};

const needsBalanceForAudio = (error: unknown) => error instanceof OpenAI.APIError && error.status === 402 && /audio/i.test(error.message);

const usageOf = (u: OpenAI.CompletionUsage | undefined): TokenUsage | undefined =>
  u ? { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, audioTokens: u.prompt_tokens_details?.audio_tokens } : undefined;

/** Texto de la respuesta o error explicativo (respuesta vacía, rechazo, corte por longitud). */
const textOf = (completion: OpenAI.Chat.Completions.ChatCompletion): string => {
  const choice = completion.choices[0];
  if (!choice) throw new ProviderError('OpenRouter devolvió una respuesta sin contenido.', 'openrouter', 'parse', completion);
  if (choice.message.refusal) throw new ProviderError(`El modelo rehusó responder: ${choice.message.refusal}`, 'openrouter', 'refusal', completion);
  const text = (choice.message.content ?? '').trim();
  if (!text) {
    const cut = choice.finish_reason === 'length';
    throw new ProviderError(cut ? 'El modelo agotó el límite de tokens razonando y no llegó a responder. Sube el límite o elige otro modelo.' : 'OpenRouter devolvió una respuesta vacía.', 'openrouter', cut ? 'parse' : 'refusal', completion);
  }
  return text;
};

const parseWith = <T>(text: string, parse: (raw: unknown) => T, completion: unknown): T => {
  try { return parse(extractJson(text)); }
  catch (error) { throw new ProviderError('El modelo devolvió un JSON que no cumple el esquema.', 'openrouter', 'parse', { error, text, completion }); }
};

interface OnceResult { assessment: ProviderResult['assessment']; usage?: TokenUsage; raw: unknown }

const evaluateOnce = async (input: EvaluationInput, opts: EvaluateOptions, useAudio: boolean, useImage: boolean, structured: boolean): Promise<OnceResult> => {
  const { system, userText } = buildPrompt(input, { audio: useAudio, image: useImage });
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  if (useAudio) {
    const format = input.audio!.mimeType === 'audio/wav' ? 'wav' : 'mp3';
    content.push({ type: 'input_audio', input_audio: { data: input.audio!.base64, format } });
  }
  if (useImage) {
    content.push({ type: 'text', text: `ESPECTROGRAMA del archivo original: ${input.spectrogram!.description}` });
    content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${input.spectrogram!.base64}` } });
  }
  content.push({ type: 'text', text: userText });
  const model = findModel(opts.model);
  const systemText = structured ? system : `${system}\n\nFORMATO OBLIGATORIO: devuelve ÚNICAMENTE un objeto JSON válido (sin texto antes ni después, sin vallas de código) que cumpla este JSON Schema:\n${JSON.stringify(toCleanJsonSchema(CreativeAssessmentSchema))}`;
  const completion = await client(opts.apiKey).chat.completions.create(
    {
      model: opts.model,
      messages: [{ role: 'system', content: systemText }, { role: 'user', content }],
      temperature: opts.temperature ?? 0.2,
      max_tokens: model?.maxOutputTokens ?? 8000,
      ...(structured ? { response_format: zodResponseFormat(CreativeAssessmentSchema, 'evaluacion_creativa') } : {}),
    },
    { signal: opts.signal },
  );
  const text = textOf(completion);
  return { assessment: parseWith(text, normalizeAssessment, completion), usage: usageOf(completion.usage), raw: completion };
};

export const openrouterProvider: LLMProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  keyHelp: 'Crea una clave en https://openrouter.ai/settings/keys. Sin saldo solo funcionan los modelos gratuitos y sin audio (0,50 $ mínimo para audio).',

  async evaluate(input: EvaluationInput, opts: EvaluateOptions): Promise<ProviderResult> {
    const model = findModel(opts.model);
    const wantsAudio = !!input.audio && (model?.inputs.audio ?? true);
    const useImage = !!input.spectrogram && (model?.inputs.image ?? true);
    const structured = model?.structuredOutput ?? false;
    const warnings: string[] = [];
    const t0 = Date.now();
    let result: OnceResult;
    try {
      try {
        result = await evaluateOnce(input, opts, wantsAudio, useImage, structured);
      } catch (error) {
        if (!wantsAudio || !needsBalanceForAudio(error)) throw error;
        warnings.push(AUDIO_BALANCE_WARNING);
        result = await evaluateOnce(input, opts, false, useImage, structured);
      }
    } catch (error) {
      throw mapError(error);
    }
    return { ...result, model: opts.model, provider: 'openrouter', elapsedMs: Date.now() - t0, warnings };
  },

  async generateJson<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
    const model = findModel(req.model);
    const structured = model?.structuredOutput ?? false;
    const system = structured ? req.system : `${req.system}\n\nFORMATO OBLIGATORIO: devuelve ÚNICAMENTE un objeto JSON válido (sin texto antes ni después, sin vallas de código) que cumpla este JSON Schema:\n${JSON.stringify(toCleanJsonSchema(req.schema))}`;
    const t0 = Date.now();
    try {
      const completion = await client(req.apiKey).chat.completions.create(
        {
          model: req.model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: req.user }],
          temperature: req.temperature ?? 0.3,
          max_tokens: req.maxOutputTokens ?? model?.maxOutputTokens ?? 4000,
          ...(structured ? { response_format: zodResponseFormat(req.schema, req.schemaName) } : {}),
        },
        { signal: req.signal },
      );
      const text = textOf(completion);
      return { data: parseWith(text, (raw) => req.schema.parse(raw), completion), usage: usageOf(completion.usage), raw: completion, elapsedMs: Date.now() - t0 };
    } catch (error) {
      throw mapError(error);
    }
  },
};
