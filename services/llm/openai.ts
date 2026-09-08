import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { buildPrompt } from './prompt';
import { CreativeAssessmentSchema, creativeAssessmentJsonSchema, normalizeAssessment, toCleanJsonSchema } from './schema';
import { extractJson } from './json';
import { findModel } from './catalog';
import { ProviderError, type EvaluateOptions, type EvaluationInput, type JsonRequest, type JsonResult, type LLMProvider, type ProviderResult } from './types';

const mapError = (error: unknown): ProviderError => {
  if (error instanceof OpenAI.AuthenticationError) return new ProviderError('Clave de API de OpenAI no válida.', 'openai', 'auth', error);
  if (error instanceof OpenAI.RateLimitError) return new ProviderError('Límite de peticiones o cuota de OpenAI alcanzado. Espera un momento o revisa tu facturación.', 'openai', 'quota', error);
  if (error instanceof OpenAI.BadRequestError) return new ProviderError(`OpenAI rechazó la petición: ${error.message}`, 'openai', 'bad-request', error);
  if (error instanceof OpenAI.APIConnectionError) return new ProviderError('No se pudo conectar con OpenAI (red o CORS).', 'openai', 'network', error);
  if (error instanceof OpenAI.APIError) return new ProviderError(`Error de OpenAI (${error.status}): ${error.message}`, 'openai', (error.status ?? 0) >= 500 ? 'server' : 'unknown', error);
  if (error instanceof Error && error.name === 'AbortError') return new ProviderError('Evaluación cancelada.', 'openai', 'unknown', error);
  return new ProviderError(error instanceof Error ? error.message : 'Error desconocido de OpenAI.', 'openai', 'unknown', error);
};

export const openaiProvider: LLMProvider = {
  id: 'openai',
  label: 'OpenAI',
  keyHelp: 'Crea una clave en https://platform.openai.com/api-keys (solo los modelos gpt-audio-* aceptan audio).',

  async evaluate(input: EvaluationInput, opts: EvaluateOptions): Promise<ProviderResult> {
    const model = findModel(opts.model);
    const useAudio = !!input.audio && (model?.inputs.audio ?? true);
    const useImage = !!input.spectrogram && (model?.inputs.image ?? false);
    const { system, userText } = buildPrompt(input, { audio: useAudio, image: useImage });

    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
    if (useAudio) {
      if (input.audio!.mimeType !== 'audio/wav' && input.audio!.mimeType !== 'audio/mpeg') throw new ProviderError('OpenAI solo acepta audio wav o mp3.', 'openai', 'bad-request');
      content.push({ type: 'input_audio', input_audio: { data: input.audio!.base64, format: input.audio!.mimeType === 'audio/wav' ? 'wav' : 'mp3' } });
    }
    if (useImage) {
      content.push({ type: 'text', text: `ESPECTROGRAMA del archivo original: ${input.spectrogram!.description}` });
      content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${input.spectrogram!.base64}` } });
    }
    content.push({ type: 'text', text: userText });

    const client = new OpenAI({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content },
    ];
    const t0 = Date.now();

    // 1) Structured Outputs estrictos (json_schema). 2) Si el modelo de audio no lo soporta, json_object + validación zod.
    try {
      const completion = await client.chat.completions.parse(
        { model: opts.model, messages, modalities: ['text'], temperature: opts.temperature ?? 0.2, response_format: zodResponseFormat(CreativeAssessmentSchema, 'evaluacion_creativa') },
        { signal: opts.signal },
      );
      const choice = completion.choices[0];
      if (choice.message.refusal) throw new ProviderError(`OpenAI rehusó evaluar: ${choice.message.refusal}`, 'openai', 'refusal', completion);
      if (!choice.message.parsed) throw new ProviderError('OpenAI devolvió una respuesta sin JSON válido.', 'openai', 'parse', completion);
      return {
        assessment: normalizeAssessment(choice.message.parsed),
        usage: completion.usage ? { inputTokens: completion.usage.prompt_tokens, outputTokens: completion.usage.completion_tokens, audioTokens: completion.usage.prompt_tokens_details?.audio_tokens } : undefined,
        raw: completion, model: opts.model, provider: 'openai', elapsedMs: Date.now() - t0,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const isSchemaUnsupported = error instanceof OpenAI.BadRequestError && /response_format|json_schema|structured/i.test(error.message);
      if (!isSchemaUnsupported) throw mapError(error);
    }

    try {
      const schemaText = JSON.stringify(creativeAssessmentJsonSchema());
      const completion = await client.chat.completions.create(
        {
          model: opts.model,
          modalities: ['text'],
          temperature: opts.temperature ?? 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${system}\n\nEl JSON debe cumplir exactamente este JSON Schema:\n${schemaText}` },
            { role: 'user', content },
          ],
        },
        { signal: opts.signal },
      );
      const text = completion.choices[0]?.message.content ?? '';
      if (completion.choices[0]?.message.refusal) throw new ProviderError(`OpenAI rehusó evaluar: ${completion.choices[0].message.refusal}`, 'openai', 'refusal', completion);
      let assessment;
      try { assessment = normalizeAssessment(JSON.parse(text)); }
      catch (e) { throw new ProviderError('OpenAI devolvió un JSON que no cumple el esquema.', 'openai', 'parse', { e, text }); }
      return {
        assessment,
        usage: completion.usage ? { inputTokens: completion.usage.prompt_tokens, outputTokens: completion.usage.completion_tokens, audioTokens: completion.usage.prompt_tokens_details?.audio_tokens } : undefined,
        raw: completion, model: opts.model, provider: 'openai', elapsedMs: Date.now() - t0,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw mapError(error);
    }
  },

  async generateJson<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
    const client = new OpenAI({ apiKey: req.apiKey, dangerouslyAllowBrowser: true });
    const t0 = Date.now();
    const run = async (structured: boolean) => {
      const system = structured ? req.system : `${req.system}\n\nEl JSON debe cumplir exactamente este JSON Schema:\n${JSON.stringify(toCleanJsonSchema(req.schema))}`;
      return client.chat.completions.create(
        { model: req.model, temperature: req.temperature ?? 0.3, max_tokens: req.maxOutputTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: req.user }], response_format: structured ? zodResponseFormat(req.schema, req.schemaName) : { type: 'json_object' } },
        { signal: req.signal },
      );
    };
    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      try { completion = await run(true); }
      catch (error) {
        const unsupported = error instanceof OpenAI.BadRequestError && /response_format|json_schema|structured/i.test(error.message);
        if (!unsupported) throw error;
        completion = await run(false);
      }
    } catch (error) { throw mapError(error); }
    const choice = completion.choices[0];
    if (choice?.message.refusal) throw new ProviderError(`OpenAI rehusó redactar: ${choice.message.refusal}`, 'openai', 'refusal', completion);
    const text = choice?.message.content ?? '';
    let data: T;
    try { data = req.schema.parse(extractJson(text)); }
    catch (error) { throw new ProviderError('OpenAI devolvió un JSON que no cumple el esquema.', 'openai', 'parse', { error, text }); }
    return { data, usage: completion.usage ? { inputTokens: completion.usage.prompt_tokens, outputTokens: completion.usage.completion_tokens } : undefined, raw: completion, elapsedMs: Date.now() - t0 };
  },
};
