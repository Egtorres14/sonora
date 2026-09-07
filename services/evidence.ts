/**
 * Evidencias con momento: reúne en una sola lista, ordenada por tiempo, todo lo que sostiene
 * la evaluación y de dónde sale (medido en el archivo, anotado por el profesor o sugerido por un
 * modelo). Cada elemento puede pintarse sobre la forma de onda y saltar al instante al pulsarlo.
 */
import { EFFECTS, calculateReview, type ReviewRecord } from './review';
import { DEFAULT_RUBRIC, type RubricConfig, type ToolId } from './scoring/rubric';
import { formatTimestamp } from './audio/features';

export type EvidenceSource = 'medido' | 'profesor' | 'modelo';
export interface TimeRange { start: number; end?: number }
export interface EvidenceItem {
  id: string;
  time?: number; // segundos; ausente = afecta a todo el archivo
  end?: number;
  criterio: string;
  detalle: string;
  source: EvidenceSource;
  puntos: number | null; // null = no puntúa por sí mismo (sugerencia / pista)
  confidence?: number;
  effect?: ToolId;
}

const TIME_RE = /(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/g;
const toSeconds = (m: RegExpMatchArray) => Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3].padEnd(3, '0')) / 1000 : 0);

/** Extrae instantes y rangos («0:12–0:18», «0:12 a 0:18», «0:45») de un texto libre. */
export const parseTimeRanges = (text: string): TimeRange[] => {
  const out: TimeRange[] = [];
  const matches = [...text.matchAll(TIME_RE)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = toSeconds(m);
    const next = matches[i + 1];
    if (next) {
      const between = text.slice((m.index ?? 0) + m[0].length, next.index ?? 0);
      if (between.length <= 8 && /^\s*(?:[–—-]|a|hasta|→)\s*$/i.test(between)) {
        const end = toSeconds(next);
        if (end > start) { out.push({ start, end }); i++; continue; }
      }
    }
    out.push({ start });
  }
  return out;
};

export const fmtRange = (r: TimeRange) => (r.end !== undefined ? `${formatTimestamp(r.start)}–${formatTimestamp(r.end)}` : formatTimestamp(r.start));

export const buildEvidence = (record: ReviewRecord, rubric: RubricConfig = DEFAULT_RUBRIC): EvidenceItem[] => {
  const f = record.features;
  const score = calculateReview(record, rubric);
  const items: EvidenceItem[] = [];

  // --- Medido en el archivo ---
  const clicks = f.clicks.events.filter((e) => e.confidence >= rubric.technical.clickMinConfidence);
  const clickLine = score.technical.lines.find((l) => l.criterio.startsWith('Clics'));
  clicks.forEach((e, i) => items.push({
    id: `click-${i}`, time: e.time, criterio: e.kind === 'click' ? 'Clic de edición' : 'Corte sin crossfade', source: 'medido',
    detalle: `Confianza ${Math.round(e.confidence * 100)} %${i === 0 && clicks.length > 1 ? ` · ${clicks.length} eventos en total` : ''}`,
    puntos: i === 0 ? clickLine?.puntos ?? 0 : null,
  }));
  if (f.clipping.detected) {
    const line = score.technical.lines.find((l) => l.criterio.startsWith('Clipping'));
    f.clipping.timestamps.slice(0, 10).forEach((t, i) => items.push({ id: `clip-${i}`, time: t, criterio: 'Saturación', source: 'medido', detalle: i === 0 ? `${f.clipping.runCount} rachas · true peak ${f.levels.truePeakDbtp} dBTP` : 'Racha de saturación', puntos: i === 0 ? line?.puntos ?? 0 : null }));
  }
  f.silence.gaps.slice(0, 5).forEach((g, i) => items.push({ id: `gap-${i}`, time: g.start, end: g.end, criterio: 'Silencio interno', source: 'medido', detalle: `${(g.end - g.start).toFixed(2)} s sin señal`, puntos: null }));
  f.heuristics.reverseEnvelopeTimes.slice(0, 5).forEach((t, i) => items.push({ id: `rev-${i}`, time: t, criterio: 'Pista de reversa', source: 'medido', detalle: 'Crescendo largo y corte seco (heurístico, no prueba)', puntos: null, effect: 'reversa' }));
  for (const line of score.technical.lines) {
    if (line.criterio.startsWith('Clics') || line.criterio.startsWith('Clipping')) continue;
    if (line.puntos !== 0 || line.criterio === 'Frecuencia de muestreo') items.push({ id: `tech-${line.criterio}`, criterio: line.criterio, source: 'medido', detalle: line.detalle, puntos: line.puntos });
  }

  // --- Anotado por el profesor ---
  for (const effect of EFFECTS) {
    const label = record.labels[effect.id];
    if (label === 'unknown') continue;
    const line = score.creative.lines.find((l) => l.criterio.toLowerCase() === effect.label.toLowerCase());
    const ranges = parseTimeRanges(record.evidence[effect.id] || '');
    const detalle = record.evidence[effect.id]?.trim() || (label === 'present' ? 'Uso confirmado' : 'Ausencia confirmada');
    if (ranges.length) ranges.forEach((r, i) => items.push({ id: `teacher-${effect.id}-${i}`, time: r.start, end: r.end, criterio: `${effect.label} ${label === 'present' ? 'confirmado' : 'ausente'}`, source: 'profesor', detalle, puntos: i === 0 ? line?.puntos ?? 0 : null, effect: effect.id }));
    else items.push({ id: `teacher-${effect.id}`, criterio: `${effect.label} ${label === 'present' ? 'confirmado' : 'ausente'}`, source: 'profesor', detalle, puntos: line?.puntos ?? 0, effect: effect.id });
  }
  if (record.overprocessing !== 'unknown') {
    const line = score.creative.lines.find((l) => l.criterio === 'Sobreprocesamiento');
    items.push({ id: 'teacher-over', criterio: 'Sobreprocesamiento', source: 'profesor', detalle: line?.detalle ?? '', puntos: line?.puntos ?? 0 });
  }
  if (record.extra !== 'unknown') items.push({ id: 'teacher-extra', criterio: 'Efectos extra', source: 'profesor', detalle: record.extra === 'present' ? 'Confirmados' : 'No se aprecian', puntos: record.extra === 'present' ? score.bonus : 0 });

  // --- Sugerido por un modelo externo ---
  const ai = record.ai;
  if (ai) {
    for (const tool of ai.evaluacion_creatividad_y_procesamiento.herramientas_utilizadas) {
      if (!tool.detectado) continue;
      const ranges = parseTimeRanges(tool.comentarios || '');
      const base = { criterio: `${EFFECTS.find((e) => e.id === tool.herramienta)?.label ?? tool.herramienta} sugerido`, source: 'modelo' as const, detalle: tool.comentarios, puntos: null, confidence: tool.confianza, effect: tool.herramienta };
      if (ranges.length) ranges.forEach((r, i) => items.push({ id: `ai-${tool.herramienta}-${i}`, time: r.start, end: r.end, ...base }));
      else items.push({ id: `ai-${tool.herramienta}`, ...base });
    }
    if (ai.puntos_extra.detectado) items.push({ id: 'ai-extra', criterio: 'Efectos extra sugeridos', source: 'modelo', detalle: `${ai.puntos_extra.cuales.join(', ')}${ai.puntos_extra.comentarios ? ` · ${ai.puntos_extra.comentarios}` : ''}`, puntos: null, confidence: ai.puntos_extra.confianza });
  }

  return items.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || a.source.localeCompare(b.source));
};

export const SOURCE_LABEL: Record<EvidenceSource, string> = { medido: 'Medido', profesor: 'Profesor', modelo: 'Modelo' };
export const SOURCE_COLOR: Record<EvidenceSource, string> = { medido: 'rgba(228,176,123,.85)', profesor: 'rgba(239,239,230,.28)', modelo: 'rgba(199,235,153,.55)' };
