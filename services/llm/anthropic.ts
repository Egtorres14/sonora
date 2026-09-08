import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { buildPrompt } from './prompt';
import { CreativeAssessmentSchema, normalizeAssessment } from './schema';
import { findModel } from './catalog';
import { ProviderError, type EvaluateOptions, type EvaluationInput, type JsonRequest, type JsonResult, type LLMProvider, type ProviderResult } from './types';

const mapError = (error: unknown): ProviderError => {
  if (error instanceof Anthropic.AuthenticationError) return new ProviderError('Clave de API de Anthropic no válida.', 'anthropic', 'auth', error);
  if (error instanceof Anthropic.RateLimitError) return new ProviderError('Límite de peticiones de Anthropic alcanzado. Espera un momento.', 'anthropic', 'quota', error);
  if (error instanceof Anthropic.BadRequestError) return new ProviderError(`Anthropic rechazó la petición: ${error.message}`, 'anthropic', 'bad-request', error);
  if (error instanceof Anthropic.APIConnectionError) return new ProviderError('No se pudo conectar con Anthropic (red o CORS).', 'anthropic', 'network', error);
  if (error instanceof Anthropic.APIError) return new ProviderError(`Error de Anthropic (${error.status}): ${error.message}`, 'anthropic', (error.status ?? 0) >= 500 ? 'server' : 'unknown', error);
  if (error instanceof Error && error.name === 'AbortError') return new ProviderError('Evaluación cancelada.', 'anthropic', 'unknown', error);
  return new ProviderError(error instanceof Error ? error.message : 'Error desconocido de Anthropic.', 'anthropic', 'unknown', error);
};

export const anthropicProvider: LLMProvider = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  keyHelp: 'Crea una clave en https://console.anthropic.com/settings/keys (Claude no escucha audio: evalúa espectrograma + métricas).',

  async evaluate(input: EvaluationInput, opts: EvaluateOptions): Promise<ProviderResult> {
    const model = findModel(opts.model);
    const useImage = !!input.spectrogram && (model?.inputs.image ?? true);
    // Claude no acepta audio: siempre trabaja con espectrograma + métricas.
    const { system, userText } = buildPrompt(input, { audio: false, image: useImage });

    const content: Anthropic.ContentBlockParam[] = [];
    if (useImage) {
      content.push({ type: 'text', text: `ESPECTROGRAMA del archivo original: ${input.spectrogram!.description}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: input.spectrogram!.base64 } });
    }
    if (input.waveform && useImage) {
      content.push({ type: 'text', text: `FORMA DE ONDA: ${input.waveform.description}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: input.waveform.base64 } });
    }
    content.push({ type: 'text', text: userText });

    const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
    const t0 = Date.now();
    let response;
    try {
      // Nota: en Claude Opus 5 / Sonnet 5 el pensamiento adaptativo está activo por defecto y
      // temperature/top_p ya no se aceptan, por eso no se envían parámetros de muestreo.
      response = await client.messages.parse(
        {
          model: opts.model,
          max_tokens: model?.maxOutputTokens ?? 8000,
          system,
          messages: [{ role: 'user', content }],
          output_config: { format: zodOutputFormat(CreativeAssessmentSchema) },
        },
        { signal: opts.signal },
      );
    } catch (error) {
      throw mapError(error);
    }

    if (response.stop_reason === 'refusal') {
      throw new ProviderError(`Claude rehusó evaluar${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : '.'}`, 'anthropic', 'refusal', response);
    }
    if (response.stop_reason === 'max_tokens') throw new ProviderError('La respuesta de Claude se cortó por longitud. Reintenta.', 'anthropic', 'parse', response);
    if (!response.parsed_output) throw new ProviderError('Claude devolvió una respuesta sin JSON válido.', 'anthropic', 'parse', response);

    return {
      assessment: normalizeAssessment(response.parsed_output),
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      raw: response,
      model: opts.model,
      provider: 'anthropic',
      elapsedMs: Date.now() - t0,
    };
  },

  async generateJson<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
    const client = new Anthropic({ apiKey: req.apiKey, dangerouslyAllowBrowser: true });
    const model = findModel(req.model);
    const t0 = Date.now();
    let response;
    try {
      response = await client.messages.parse(
        { model: req.model, max_tokens: req.maxOutputTokens ?? model?.maxOutputTokens ?? 4000, system: req.system, messages: [{ role: 'user', content: req.user }], output_config: { format: zodOutputFormat(req.schema) } },
        { signal: req.signal },
      );
    } catch (error) { throw mapError(error); }
    if (response.stop_reason === 'refusal') throw new ProviderError('Claude rehusó redactar.', 'anthropic', 'refusal', response);
    if (!response.parsed_output) throw new ProviderError('Claude devolvió una respuesta sin JSON válido.', 'anthropic', 'parse', response);
    return { data: response.parsed_output as T, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }, raw: response, elapsedMs: Date.now() - t0 };
  },
};
