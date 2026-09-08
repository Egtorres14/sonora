import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { extractJson } from '../services/llm/json';
import { openrouterProvider, AUDIO_BALANCE_WARNING } from '../services/llm/openrouter';
import { testKey } from '../services/llm/keycheck';
import { buildPrompt } from '../services/llm/prompt';
import { buildFeedbackPrompt, FeedbackSchema } from '../services/llm/writer';
import { loadEngineSettings, saveEngineSettings, resetEngineSettings, DEFAULT_ENGINES, engineCost } from '../services/engines';
import { findModel, modelsFor } from '../services/llm/catalog';
import type { EvaluationInput } from '../services/llm/types';
import { DEFAULT_RUBRIC } from '../services/scoring/rubric';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';
import { createReview } from '../services/review';

const features = () => {
  const sr = 48000;
  const x = Float32Array.from({ length: sr * 3 }, (_, i) => Math.sin(i * 2 * Math.PI * 220 / sr) * 0.2);
  return extractFeatures(decodePcm(encodeWav16([x], sr))!);
};
const input = (over: Partial<EvaluationInput> = {}): EvaluationInput => ({ fileName: 'campana.wav', synopsis: 'Campana invertida en 0:04.', context: 'Reversa.', features: features(), rubric: DEFAULT_RUBRIC, ...over });

const assessmentJson = () => JSON.stringify({
  descripcion_sonora: 'Campana en 0:00 y su reversa en 0:04.',
  herramientas: [{ herramienta: 'reversa', detectado: true, confianza: 0.9, evidencia: '0:04–0:07 cola que crece y corta', calidad_de_uso: 'Buena' }],
  sobreprocesamiento: { detectado: false, nivel: 'N/A', confianza: 0.8, comentarios: '' },
  efectos_extra: { detectado: false, cuales: [], confianza: 0.8, comentarios: '' },
  coherencia_con_sinopsis: { puntuacion: 4, comentarios: 'Coincide.' },
  fortalezas: ['Reversa clara'], mejoras: ['Fundidos en los cortes'], comentarios_generales: 'Bien.', limitaciones: 'Mono 16 kHz.',
});

describe('extractJson', () => {
  it('quita vallas y razonamiento previo', () => {
    expect(extractJson('Pensando… ```json\n{"a": 1, "b": "x}y"}\n```')).toEqual({ a: 1, b: 'x}y' });
  });
  it('respeta llaves anidadas y comillas escapadas', () => {
    expect(extractJson('{"a": {"b": "di \\"hola\\" }"}, "c": [1, {"d": 2}]} basura')).toEqual({ a: { b: 'di "hola" }' }, c: [1, { d: 2 }] });
  });
  it('falla con claridad si no hay JSON o está incompleto', () => {
    expect(() => extractJson('sin nada')).toThrow(/no contiene JSON/);
    expect(() => extractJson('{"a": 1')).toThrow(/incompleto/);
  });
});

describe('Proveedor OpenRouter', () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const completion = (content: string) => new Response(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  beforeEach(() => { calls.length = 0; });
  afterEach(() => vi.unstubAllGlobals());

  it('reintenta sin audio cuando OpenRouter exige saldo para audio y lo deja en warnings', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url: String(url), body });
      if (calls.length === 1) return new Response(JSON.stringify({ error: { message: 'This request requires at least $0.50 in balance for audio', code: 402 } }), { status: 402, headers: { 'content-type': 'application/json' } });
      return completion(`Analizo primero… \n\`\`\`json\n${assessmentJson()}\n\`\`\``);
    }));
    const r = await openrouterProvider.evaluate(
      input({ audio: { base64: 'AAAA', mimeType: 'audio/wav', sampleRate: 16000, channels: 1, durationSec: 3, bytes: 4 }, spectrogram: { base64: 'BBBB', mimeType: 'image/png', width: 10, height: 10, description: 'test' } }),
      { model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', apiKey: 'sk-or-test' },
    );
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('openrouter.ai/api/v1/chat/completions');
    const parts = (calls[0].body.messages as { content: unknown }[])[1].content as { type: string }[];
    expect(parts.map((p) => p.type)).toEqual(['input_audio', 'text', 'image_url', 'text']);
    const retryParts = (calls[1].body.messages as { content: unknown }[])[1].content as { type: string }[];
    expect(retryParts.map((p) => p.type)).toEqual(['text', 'image_url', 'text']);
    expect(calls[1].body.response_format).toBeUndefined(); // el modelo gratuito no admite JSON estricto
    expect(String((calls[1].body.messages as { content: string }[])[0].content)).toMatch(/FORMATO OBLIGATORIO/);
    expect(r.warnings).toEqual([AUDIO_BALANCE_WARNING]);
    expect(r.assessment.herramientas.find((h) => h.herramienta === 'reversa')?.detectado).toBe(true);
    expect(r.assessment.herramientas).toHaveLength(5);
    expect(r.usage?.inputTokens).toBe(100);
  });

  it('usa JSON estricto en modelos que lo soportan y no reintenta otros errores', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return completion(assessmentJson());
    }));
    const r = await openrouterProvider.evaluate(input({ spectrogram: { base64: 'BBBB', mimeType: 'image/png', width: 10, height: 10, description: 'test' } }), { model: 'google/gemini-3.8-flash', apiKey: 'sk-or-test' });
    expect(calls).toHaveLength(1);
    expect((calls[0].body.response_format as { type: string }).type).toBe('json_schema');
    expect(r.warnings).toEqual([]);
  });

  it('traduce el 402 sin audio a un error de saldo comprensible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Insufficient credits', code: 402 } }), { status: 402, headers: { 'content-type': 'application/json' } })));
    await expect(openrouterProvider.evaluate(input(), { model: 'google/gemini-3.8-flash', apiKey: 'sk-or-test' })).rejects.toMatchObject({ kind: 'quota', message: expect.stringContaining('saldo') });
  });

  it('generateJson valida contra el esquema pedido', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => completion('{"texto": "Hola, Ana.", "fortalezas": ["Reversa clara"], "mejoras": ["Fundidos"]}')));
    const r = await openrouterProvider.generateJson({ system: 's', user: 'u', schema: FeedbackSchema, schemaName: 'feedback', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', apiKey: 'sk-or-test' });
    expect(r.data.texto).toBe('Hola, Ana.');
    expect(r.data.mejoras).toEqual(['Fundidos']);
  });

  it('«Probar» informa del saldo y de la limitación de audio', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/key')) return new Response(JSON.stringify({ data: { label: 'k', is_free_tier: true } }), { status: 200 });
      return new Response(JSON.stringify({ data: { total_credits: 0, total_usage: 0 } }), { status: 200 });
    }));
    const r = await testKey('openrouter', 'sk-or-test');
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/0[.,]00 \$/);
    expect(r.message).toMatch(/audio/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    expect((await testKey('openrouter', 'mala')).ok).toBe(false);
  });
});

describe('Catálogo y ajustes con OpenRouter', () => {
  beforeEach(() => resetEngineSettings());
  it('tiene un modelo gratuito recomendado que escucha y ve, y modelos de pago con audio', () => {
    const models = modelsFor('openrouter');
    const free = models.find((m) => m.free);
    expect(free?.tag).toBe('recomendado');
    expect(free?.inputs).toEqual({ audio: true, image: true });
    expect(DEFAULT_ENGINES.models.openrouter).toBe(free?.id);
    expect(engineCost({ ...DEFAULT_ENGINES, engine: 'openrouter' }, 60)).toBe(0);
    expect(engineCost({ ...DEFAULT_ENGINES, engine: 'openrouter', models: { ...DEFAULT_ENGINES.models, openrouter: 'google/gemini-3.8-flash' } }, 60)).toBeGreaterThan(0);
    expect(findModel('google/gemini-3.8-flash')?.structuredOutput).toBe(true);
  });
  it('persiste y sanea los modos de análisis y de redacción', () => {
    expect(loadEngineSettings().analysisMode).toBe('independiente');
    expect(loadEngineSettings().feedbackWriter).toBe('local');
    saveEngineSettings({ ...DEFAULT_ENGINES, engine: 'openrouter', analysisMode: 'refuerzo', feedbackWriter: 'ia' });
    const s = loadEngineSettings();
    expect(s.engine).toBe('openrouter'); expect(s.analysisMode).toBe('refuerzo'); expect(s.feedbackWriter).toBe('ia');
    saveEngineSettings({ ...DEFAULT_ENGINES, analysisMode: 'lo-que-sea' as never, feedbackWriter: 'otro' as never });
    expect(loadEngineSettings().analysisMode).toBe('independiente');
    expect(loadEngineSettings().feedbackWriter).toBe('local');
  });
});

describe('Prompt en modo refuerzo', () => {
  it('sin pistas no menciona el refuerzo; con pistas describe clasificador y profesor', () => {
    expect(buildPrompt(input(), { audio: true, image: true }).system).not.toMatch(/REFUERZO/);
    const { system } = buildPrompt(input({ hints: {
      local: [{ effect: 'reversa', predicted: true, voteShare: 0.82, balancedAccuracy: 0.62 }, { effect: 'loops', predicted: null, voteShare: 0.5, balancedAccuracy: 0.74 }],
      teacher: [{ effect: 'reversa', label: 'present', evidence: '0:04–0:07 cola invertida' }, { effect: 'filtros', label: 'unknown', evidence: '' }],
      overprocessing: 'Leve', extra: 'unknown',
    } }), { audio: true, image: true });
    expect(system).toMatch(/REFUERZO: LO QUE YA SE SABE/);
    expect(system).toMatch(/reversa: sugiere PRESENCIA \(votos por presencia 82 %, exactitud equilibrada del clasificador 62 %\)/);
    expect(system).toMatch(/loops: se abstiene/);
    expect(system).toMatch(/reversa: PRESENTE · evidencia: "0:04–0:07 cola invertida"/);
    expect(system).toMatch(/filtros: pendiente/);
    expect(system).toMatch(/Sobreprocesamiento según el profesor: Leve/);
    expect(system).toMatch(/nunca cambies tu detección solo para coincidir/);
  });
});

describe('Redactor de feedback con IA', () => {
  it('construye el prompt solo con lo decidido y lo medido, y marca lo pendiente', () => {
    const r = createReview('a'.repeat(64), 'campana_procesada.wav', features());
    r.student = { name: 'Ana López', submittedAt: new Date().toISOString() };
    r.labels.reversa = 'present'; r.evidence.reversa = '0:04–0:07 cola invertida';
    r.labels.filtros = 'absent';
    r.synopsis = 'Invertí la campana y la filtré.';
    r.notes = 'Muy buen gesto inicial.';
    const { system, user } = buildFeedbackPrompt(r, DEFAULT_RUBRIC);
    expect(system).toMatch(/revisión YA CERRADA/);
    expect(system).toMatch(/No evalúas, no detectas/);
    expect(user).toContain('ESTUDIANTE: Ana López');
    expect(user).toMatch(/Reversa \[exigida por la rúbrica\]: PRESENTE \(confirmado por el profesor\) · evidencia del profesor: "0:04–0:07 cola invertida"/);
    expect(user).toMatch(/Filtros \[exigida por la rúbrica\]: AUSENTE/);
    expect(user).toMatch(/Pitch shift \[exigida por la rúbrica\]: PENDIENTE/);
    expect(user).toMatch(/Nota: PENDIENTE \(rango posible/);
    expect(user).toMatch(/NOTAS PREVIAS DEL PROFESOR \(respétalas\):\nMuy buen gesto inicial\./);
    expect(user).toMatch(/BORRADOR DE REFERENCIA/);
    expect(user).toMatch(/Sin saturación|Saturación: no/);
    expect(user).not.toMatch(/SUGERENCIAS DE UN MODELO EXTERNO/);
    expect(FeedbackSchema.parse({ texto: 'Hola', fortalezas: [], mejoras: [] }).texto).toBe('Hola');
  });
});
