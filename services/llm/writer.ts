/**
 * Redactor de feedback con IA. NO evalúa ni detecta nada: recibe la revisión ya cerrada por el profesor
 * (etiquetas, evidencias, desglose de nota, mediciones, borrador local) y la convierte en un texto claro
 * para el estudiante. El profesor lo edita antes de publicarlo.
 */
import { z } from 'zod';
import { calculateReview, EFFECTS, type ReviewRecord } from '../review';
import { buildEvidence, fmtRange } from '../evidence';
import { draftFeedback } from '../feedback';
import { DEFAULT_RUBRIC, type RubricConfig } from '../scoring/rubric';
import { formatTimestamp } from '../audio/features';
import { PROVIDERS } from './index';
import { findModel } from './catalog';
import { ProviderError, type ProviderId, type TokenUsage } from './types';

export const FeedbackSchema = z.object({
  texto: z.string().describe('Feedback completo para el estudiante, en segunda persona, 6-10 frases, con tiempos (m:ss) cuando aplique.'),
  fortalezas: z.array(z.string()).describe('2-4 puntos fuertes concretos, cada uno ligado a una decisión del profesor o a una medición.'),
  mejoras: z.array(z.string()).describe('2-4 mejoras accionables: qué hacer, dónde y con qué herramienta del DAW.'),
});
export type WrittenFeedback = z.infer<typeof FeedbackSchema>;

const LABEL_TEXT = { present: 'PRESENTE (confirmado por el profesor)', absent: 'AUSENTE (confirmado por el profesor)', unknown: 'PENDIENTE (el profesor aún no ha decidido)' } as const;
const num = (n: number) => n.toLocaleString('es', { maximumFractionDigits: 2 });

export interface FeedbackPromptParts { system: string; user: string }

export const buildFeedbackPrompt = (record: ReviewRecord, rubric: RubricConfig = DEFAULT_RUBRIC): FeedbackPromptParts => {
  const score = calculateReview(record, rubric);
  const evidence = buildEvidence(record, rubric);
  const local = draftFeedback(record, rubric);
  const f = record.features;
  const required = new Set(rubric.creative.requiredTools);
  const who = record.student?.name?.trim() || '';

  const system = `Eres el profesor de producción de audio que firma la revisión de un proyecto de estudiante. Tu ÚNICA tarea es REDACTAR el feedback final a partir de una revisión YA CERRADA. No evalúas, no detectas, no opinas sobre lo que no está en los datos.

REGLAS
1. Usa exclusivamente los datos que recibes: decisiones del profesor, mediciones del archivo y desglose de la rúbrica. Cada frase debe poder rastrearse a uno de ellos.
2. Lo que el profesor marcó PENDIENTE no existe para el feedback: no lo des por hecho ni lo menciones como carencia.
3. Las sugerencias de un modelo externo (si las hay) NO son decisiones: úsalas solo para enriquecer la descripción de algo que el profesor ya confirmó, nunca para añadir detecciones nuevas.
4. Cita tiempos (m:ss) cuando los datos los traigan. No inventes tiempos, herramientas, artefactos ni cifras. Si una herramienta exigida está AUSENTE, propón cómo incorporarla con sentido musical, no como trámite; no propongas usar una herramienta para "cumplir" otro criterio (por ejemplo, alargar con time stretch para llegar a la duración).
5. No cambies la nota ni sugieras otra. Si la nota está cerrada, menciónala una vez al final; si no, di que se cerrará al terminar la revisión. No cites puntos ni penalizaciones criterio a criterio ("+2,5", "-1"): el estudiante ve el desglose en la app; tú explicas el porqué.
6. Tono: cercano, exigente y concreto; segunda persona; español. Sin listas dentro de "texto" (prosa), 6-10 frases.
7. Estructura de "texto": saludo con el nombre si lo hay → qué funciona (con datos) → qué mejorar y cómo hacerlo en el DAW → nota o estado → un siguiente paso.
8. Respeta las notas previas del profesor si existen: intégralas, no las contradigas.
9. Responde ÚNICAMENTE con el JSON del esquema: { "texto", "fortalezas", "mejoras" }.`;

  const decisions = EFFECTS.map((e) => `- ${e.label}${required.has(e.id) ? ' [exigida por la rúbrica]' : ' [opcional]'}: ${LABEL_TEXT[record.labels[e.id]]}${record.evidence[e.id]?.trim() ? ` · evidencia del profesor: "${record.evidence[e.id].trim()}"` : ''}`).join('\n');
  const overText = record.overprocessing === 'unknown' ? 'PENDIENTE' : record.overprocessing === 'none' ? 'No se aprecia (sin penalización)' : `Nivel ${record.overprocessing} (penalizado)`;
  const extraText = record.extra === 'unknown' ? 'PENDIENTE' : record.extra === 'present' ? `Confirmados (+${num(rubric.bonus.points)})` : 'Sin efectos extra';
  const lines = [...score.formal.lines, ...score.technical.lines, ...score.creative.lines].map((l) => `- ${l.criterio}: ${'pending' in l && l.pending ? 'pendiente' : `${l.puntos > 0 ? '+' : ''}${num(l.puntos)}`} · ${l.detalle}`).join('\n');
  const clicks = f.clicks.events.slice(0, 10).map((e) => formatTimestamp(e.time).replace(/\.\d+$/, '')).join(', ');
  const clips = f.clipping.timestamps.slice(0, 5).map((t) => formatTimestamp(t).replace(/\.\d+$/, '')).join(', ');
  const measured = [
    `- Formato: ${f.format.sampleRate} Hz, ${f.format.bitDepth || '?'} bits, ${f.format.channels} canal(es), ${f.format.duration.toFixed(1)} s.`,
    `- Nivel: pico real ${num(f.levels.truePeakDbtp)} dBTP, sonoridad integrada ${num(f.levels.integratedLufs)} LUFS.`,
    `- Saturación: ${f.clipping.detected ? `SÍ (${f.clipping.runCount} rachas${clips ? `, desde ${clips}` : ''})` : 'no'}.`,
    `- Clics o cortes secos: ${f.clicks.count + f.clicks.discontinuities}${clicks ? ` en ${clicks}` : ''}.`,
    `- Silencio inicial ${num(f.silence.leadingSec)} s, final ${num(f.silence.trailingSec)} s, huecos internos ${f.silence.gaps.length}.`,
  ].join('\n');
  const timed = evidence.filter((i) => i.time !== undefined && i.source !== 'medido').slice(0, 12).map((i) => `- ${fmtRange({ start: i.time!, end: i.end }).replace(/\.000/g, '')} · ${i.criterio} (${i.source})`).join('\n');
  const ai = record.ai;
  const aiText = ai ? `\nSUGERENCIAS DE UN MODELO EXTERNO (${ai.meta.modelLabel}; NO son decisiones, solo contexto):\n- Descripción sonora: ${ai.evaluacion_creatividad_y_procesamiento.descripcion_sonora}\n- Fortalezas sugeridas: ${ai.resumen_y_calificacion_final.fortalezas.join(' | ')}\n- Mejoras sugeridas: ${ai.resumen_y_calificacion_final.mejoras.join(' | ')}` : '';

  const user = `ESTUDIANTE: ${who || '(sin nombre)'}
ARCHIVO: "${record.name}"
SINOPSIS DEL ESTUDIANTE: ${record.synopsis.trim() || '(no entregó sinopsis)'}
OBJETIVO DEL EJERCICIO: ${record.context.trim() || '(sin contexto)'}

DECISIONES DEL PROFESOR (la única verdad sobre las herramientas creativas):
${decisions}
- Sobreprocesamiento: ${overText}
- Efectos extra: ${extraText}

DESGLOSE DE LA RÚBRICA (calculado por la aplicación):
${lines}
- Nota: ${score.final === null ? `PENDIENTE (rango posible ${num(score.minimum)}–${num(score.maximum)} de ${num(score.maxTotal)}); quedan por decidir: ${score.pending.join(', ')}` : `${num(score.final)} / ${num(score.maxTotal)}${score.manual ? ' (ajustada manualmente por el profesor)' : ''}`}

MEDICIONES DEL ARCHIVO (objetivas):
${measured}
${timed ? `\nEVIDENCIAS CON TIEMPO:\n${timed}` : ''}
${record.notes.trim() ? `\nNOTAS PREVIAS DEL PROFESOR (respétalas):\n${record.notes.trim()}` : ''}
${aiText}

BORRADOR DE REFERENCIA (generado sin IA a partir de los mismos datos; mejóralo en claridad y calidez sin añadir hechos):
${local.text}

Redacta ahora el feedback y devuelve solo el JSON.`;

  return { system, user };
};

export interface WriteFeedbackConfig { provider: ProviderId; model: string; apiKey: string; signal?: AbortSignal }
export interface WriteFeedbackResult extends WrittenFeedback { usage?: TokenUsage; elapsedMs: number; model: string }

export const writeFeedback = async (record: ReviewRecord, rubric: RubricConfig, cfg: WriteFeedbackConfig): Promise<WriteFeedbackResult> => {
  const provider = PROVIDERS[cfg.provider];
  if (!provider) throw new ProviderError(`Proveedor desconocido: ${cfg.provider}`, cfg.provider, 'bad-request');
  if (!cfg.apiKey.trim()) throw new ProviderError(`Falta la clave de API de ${provider.label}. ${provider.keyHelp}`, cfg.provider, 'auth');
  const model = findModel(cfg.model);
  if (!model || model.provider !== cfg.provider) throw new ProviderError(`Modelo no reconocido: ${cfg.model}`, cfg.provider, 'bad-request');
  const { system, user } = buildFeedbackPrompt(record, rubric);
  const result = await provider.generateJson({ system, user, schema: FeedbackSchema, schemaName: 'feedback_estudiante', model: cfg.model, apiKey: cfg.apiKey, temperature: 0.4, signal: cfg.signal });
  return { ...result.data, usage: result.usage, elapsedMs: result.elapsedMs, model: cfg.model };
};
