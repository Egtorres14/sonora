import { GoogleGenAI, ApiError } from '@google/genai';
import { buildPrompt } from './prompt';
import { creativeAssessmentJsonSchema, normalizeAssessment } from './schema';
import { findModel } from './catalog';
import { ProviderError, type EvaluateOptions, type EvaluationInput, type LLMProvider, type ProviderResult } from './types';

const MAX_INLINE_BYTES = 18 * 1024 * 1024; // límite documentado: 20 MB por petición (incluye prompt)

const mapError = (error: unknown): ProviderError => {
  if (error instanceof ApiError) {
    const s = error.status;
    // Gemini responde 400 (no 401) cuando la clave es inválida
    if (s === 401 || s === 403 || /API_KEY_INVALID|API key not valid|API key expired/i.test(error.message)) return new ProviderError('La clave de API de Gemini no es válida o ha caducado. Revísala en https://aistudio.google.com/apikey.', 'gemini', 'auth', error);
    if (/PERMISSION_DENIED|not found for API version|is not supported/i.test(error.message)) return new ProviderError(`Gemini no acepta esta petición para el modelo elegido: ${error.message.slice(0, 200)}`, 'gemini', 'bad-request', error);
    if (s === 429 && /credits|prepay|billing/i.test(error.message)) return new ProviderError('El proyecto de AI Studio de esta clave no tiene saldo. Añade crédito o activa la facturación en https://ai.studio/projects y vuelve a intentarlo.', 'gemini', 'quota', error);
    if (s === 429) return new ProviderError('Cuota de Gemini agotada o límite de peticiones alcanzado. Espera un momento o revisa tu plan.', 'gemini', 'quota', error);
    if (s === 400) return new ProviderError(`Gemini rechazó la petición: ${error.message}`, 'gemini', 'bad-request', error);
    if (s >= 500) return new ProviderError('El servicio de Gemini no está disponible ahora mismo. Inténtalo de nuevo.', 'gemini', 'server', error);
    return new ProviderError(`Error de Gemini (${s}): ${error.message}`, 'gemini', 'unknown', error);
  }
  if (error instanceof Error && error.name === 'AbortError') return new ProviderError('Evaluación cancelada.', 'gemini', 'unknown', error);
  if (error instanceof TypeError) return new ProviderError('No se pudo conectar con Gemini (red o CORS).', 'gemini', 'network', error);
  return new ProviderError(error instanceof Error ? error.message : 'Error desconocido de Gemini.', 'gemini', 'unknown', error);
};

export const geminiProvider: LLMProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  keyHelp: 'Crea una clave en https://aistudio.google.com/apikey',

  async evaluate(input: EvaluationInput, opts: EvaluateOptions): Promise<ProviderResult> {
    const model = findModel(opts.model);
    const useAudio = !!input.audio && (model?.inputs.audio ?? true);
    const useImage = !!input.spectrogram && (model?.inputs.image ?? true);
    const { system, userText } = buildPrompt(input, { audio: useAudio, image: useImage });

    if (useAudio && input.audio!.bytes > MAX_INLINE_BYTES) {
      throw new ProviderError(`El audio preparado ocupa ${(input.audio!.bytes / 1e6).toFixed(1)} MB y supera el límite inline de Gemini (20 MB). Reduce la duración del archivo.`, 'gemini', 'bad-request');
    }

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    if (useAudio) parts.push({ inlineData: { mimeType: input.audio!.mimeType, data: input.audio!.base64 } });
    if (useImage) {
      parts.push({ text: `ESPECTROGRAMA del archivo original: ${input.spectrogram!.description}` });
      parts.push({ inlineData: { mimeType: 'image/png', data: input.spectrogram!.base64 } });
    }
    parts.push({ text: userText });

    const ai = new GoogleGenAI({ apiKey: opts.apiKey });
    const t0 = Date.now();
    let response;
    try {
      response = await ai.models.generateContent({
        model: opts.model,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseJsonSchema: creativeAssessmentJsonSchema(),
          temperature: opts.temperature ?? 0.2,
          abortSignal: opts.signal,
        },
      });
    } catch (error) {
      throw mapError(error);
    }

    const text = (response.text ?? '').trim();
    if (!text) throw new ProviderError('Gemini devolvió una respuesta vacía (posible bloqueo de seguridad).', 'gemini', 'refusal', response);
    let assessment;
    try {
      assessment = normalizeAssessment(JSON.parse(text));
    } catch (error) {
      throw new ProviderError('Gemini devolvió un JSON que no cumple el esquema.', 'gemini', 'parse', { error, text });
    }
    const u = response.usageMetadata;
    const audioTokens = u?.promptTokensDetails?.find((d) => d.modality === 'AUDIO')?.tokenCount;
    const imageTokens = u?.promptTokensDetails?.find((d) => d.modality === 'IMAGE')?.tokenCount;
    return {
      assessment,
      usage: u ? { inputTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0, audioTokens, imageTokens } : undefined,
      raw: response,
      model: opts.model,
      provider: 'gemini',
      elapsedMs: Date.now() - t0,
    };
  },
};
