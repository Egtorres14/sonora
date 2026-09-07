/**
 * Esquema de la parte SUBJETIVA de la evaluación (lo único que se pide al modelo).
 * El modelo NO calcula puntuaciones: informa de detecciones, evidencias y confianza.
 * Una única fuente de verdad (zod) → JSON Schema para Gemini/OpenAI/Anthropic.
 */
import { z } from 'zod';

export const TOOL_IDS = ['pitch_shift', 'reversa', 'time_stretch', 'loops', 'filtros'] as const;
export const ToolIdSchema = z.enum(TOOL_IDS);

export const ToolAssessmentSchema = z.object({
  herramienta: ToolIdSchema,
  detectado: z.boolean().describe('true solo si hay evidencia audible/visible clara.'),
  confianza: z.number().min(0).max(1).describe('0 = pura suposición, 1 = certeza. Sé conservador: 0.5 significa "no lo sé".'),
  evidencia: z.string().describe('Qué te hace pensarlo y en qué momento (m:ss). Si no hay evidencia, dilo.'),
  calidad_de_uso: z.enum(['Buena', 'Regular', 'Mala', 'N/A']).describe('N/A si no se detectó.'),
});

export const CreativeAssessmentSchema = z.object({
  descripcion_sonora: z.string().describe('Qué se escucha: fuentes, evolución temporal, textura, espacio. 3-5 frases con tiempos aproximados (m:ss). El profesor la usará para verificar tu análisis.'),
  herramientas: z.array(ToolAssessmentSchema).describe('Una entrada por cada herramienta: pitch_shift, reversa, time_stretch, loops, filtros.'),
  sobreprocesamiento: z.object({
    detectado: z.boolean(),
    nivel: z.enum(['Leve', 'Moderado', 'Severo', 'N/A']),
    confianza: z.number().min(0).max(1),
    comentarios: z.string().describe('Artefactos concretos (metálico, granulado, aliasing, phasiness, bombeo) y dónde.'),
  }),
  efectos_extra: z.object({
    detectado: z.boolean().describe('Uso claro de generador de tonos, delay, reverb o modulación (chorus/flanger/phaser).'),
    cuales: z.array(z.string()),
    confianza: z.number().min(0).max(1),
    comentarios: z.string(),
  }),
  coherencia_con_sinopsis: z.object({
    puntuacion: z.number().min(0).max(5).describe('0-5: ¿lo que se escucha corresponde a lo que el estudiante describe y al objetivo del ejercicio?'),
    comentarios: z.string(),
  }),
  fortalezas: z.array(z.string()).describe('2-4 puntos fuertes concretos.'),
  mejoras: z.array(z.string()).describe('2-4 mejoras accionables, con referencia temporal cuando sea posible.'),
  comentarios_generales: z.string().describe('Retroalimentación constructiva para el estudiante, en segunda persona, 4-8 frases.'),
  limitaciones: z.string().describe('Qué NO has podido evaluar con fiabilidad y por qué (p. ej. imagen estéreo, contenido > 8 kHz, duración).'),
});

export type CreativeAssessment = z.infer<typeof CreativeAssessmentSchema>;
export type ToolAssessment = z.infer<typeof ToolAssessmentSchema>;

/**
 * JSON Schema "limpio" para Gemini (`responseJsonSchema`) y para prompts de respaldo.
 * Elimina claves que algunos proveedores rechazan.
 */
export const creativeAssessmentJsonSchema = (): Record<string, unknown> => {
  const raw = z.toJSONSchema(CreativeAssessmentSchema, { target: 'draft-7' }) as Record<string, unknown>;
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === '$schema' || k === 'additionalProperties') continue;
        out[k] = strip(v);
      }
      return out;
    }
    return node;
  };
  return strip(raw) as Record<string, unknown>;
};

/** Normaliza una salida cruda del modelo: valida, rellena herramientas ausentes y acota rangos. */
export const normalizeAssessment = (raw: unknown): CreativeAssessment => {
  const parsed = CreativeAssessmentSchema.parse(raw);
  const byTool = new Map(parsed.herramientas.map((h) => [h.herramienta, h]));
  const herramientas = TOOL_IDS.map((id) => byTool.get(id) ?? { herramienta: id, detectado: false, confianza: 0, evidencia: 'El modelo no informó sobre esta herramienta.', calidad_de_uso: 'N/A' as const });
  return { ...parsed, herramientas };
};
