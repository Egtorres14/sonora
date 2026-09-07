import type { AudioFeatures, AudioEvaluation } from '../types';
import { DEFAULT_RUBRIC, scoreFormal, scoreTechnical, type ToolId } from './scoring/rubric';

export const EFFECTS: { id: ToolId; label: string; hint: string }[] = [
  { id: 'pitch_shift', label: 'Pitch shift', hint: 'Compara la altura con la fuente original. El timbre por sí solo no demuestra un cambio de tono.' },
  { id: 'time_stretch', label: 'Time stretch', hint: 'Compara la duración y los ataques con la fuente original; anota el intervalo procesado.' },
  { id: 'reversa', label: 'Reversa', hint: 'Busca colas que crecen y terminan de golpe. Una envolvente parecida es una pista, no una prueba.' },
  { id: 'filtros', label: 'Filtros', hint: 'Contrasta el espectro con la fuente y escucha barridos o recortes de frecuencia.' },
  { id: 'loops', label: 'Loops', hint: 'Localiza repeticiones y verifica sus límites. Es opcional en esta rúbrica.' },
];
export type ReviewLabel = 'unknown' | 'present' | 'absent';
export type EffectLabels = Record<ToolId, ReviewLabel>;
export interface ReviewRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  features: AudioFeatures;
  origin: 'real' | 'synthetic';
  sourceGroup: string;
  labels: EffectLabels;
  evidence: Record<ToolId, string>;
  synopsis: string;
  context: string;
  notes: string;
  overprocessing: 'unknown' | 'none' | 'Leve' | 'Moderado' | 'Severo';
  extra: ReviewLabel;
  manualScore: number | null;
  ai?: AudioEvaluation;
}

export const createReview = (id: string, name: string, features: AudioFeatures, origin: ReviewRecord['origin'] = 'real'): ReviewRecord => ({
  id, name, features, origin, sourceGroup: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  labels: Object.fromEntries(EFFECTS.map(e => [e.id, 'unknown'])) as EffectLabels,
  evidence: Object.fromEntries(EFFECTS.map(e => [e.id, ''])) as Record<ToolId, string>,
  synopsis: '', context: '', notes: '', overprocessing: 'unknown', extra: 'unknown', manualScore: null,
});

export const updateReview = (record: ReviewRecord, patch: Partial<ReviewRecord>): ReviewRecord => {
  if (patch.manualScore !== undefined && patch.manualScore !== null && (!Number.isFinite(patch.manualScore) || patch.manualScore < 0 || patch.manualScore > 30.5)) {
    throw new Error('La nota manual debe estar entre 0 y 30,5.');
  }
  return { ...record, ...patch, id: record.id, updatedAt: new Date().toISOString() };
};

export const calculateReview = (record: ReviewRecord) => {
  const r = DEFAULT_RUBRIC;
  const formal = scoreFormal(record.name, record.synopsis);
  const technical = scoreTechnical(record.features);
  const pending: string[] = [];
  let creativeTotal = r.creative.maxPoints;
  const lines = EFFECTS.filter(e => r.creative.requiredTools.includes(e.id)).map(e => {
    const label = record.labels[e.id];
    if (label === 'unknown') pending.push(e.id);
    const puntos = label === 'absent' ? -r.creative.missingToolPenalty : 0;
    creativeTotal += puntos;
    return { criterio: e.label[0].toUpperCase() + e.label.slice(1), puntos, pending: label === 'unknown', detalle: label === 'unknown' ? 'Pendiente de revisión' : label === 'present' ? 'Uso confirmado por el profesor' : 'Ausencia confirmada por el profesor' };
  });
  const unknownTools = pending.length;
  if (record.overprocessing === 'unknown') pending.push('sobreprocesamiento');
  const overPenalty = record.overprocessing === 'unknown' || record.overprocessing === 'none' ? 0 : r.creative.overprocessingPenalty[record.overprocessing];
  creativeTotal -= overPenalty;
  lines.push({ criterio: 'Sobreprocesamiento', puntos: -overPenalty, pending: record.overprocessing === 'unknown', detalle: record.overprocessing === 'unknown' ? 'Pendiente de revisión' : record.overprocessing === 'none' ? 'Sin penalización' : `Nivel ${record.overprocessing.toLowerCase()}` });
  if (record.extra === 'unknown') pending.push('efectos extra');
  const bonus = record.extra === 'present' ? r.bonus.points : 0;
  const minimumCreative = Math.max(0, creativeTotal - unknownTools * r.creative.missingToolPenalty - (record.overprocessing === 'unknown' ? 2.5 : 0));
  const maximumCreative = Math.max(0, creativeTotal);
  const base = formal.total + technical.total;
  const minimum = +(base + minimumCreative + bonus).toFixed(2);
  const maximum = +(base + maximumCreative + bonus + (record.extra === 'unknown' ? r.bonus.points : 0)).toFixed(2);
  const calculated = pending.length ? null : minimum;
  return { formal, technical, creative: { total: maximumCreative, minimum: minimumCreative, max: r.creative.maxPoints, lines }, bonus, pending, minimum, maximum, calculated, final: record.manualScore ?? calculated, manual: record.manualScore !== null };
};

export const labelProgress = (record: ReviewRecord) => EFFECTS.filter(e => record.labels[e.id] !== 'unknown').length;
