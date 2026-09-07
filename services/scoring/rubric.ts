/**
 * Rúbrica configurable y puntuación DETERMINISTA.
 *
 * Todo lo que se puede medir se puntúa aquí, en código, no en el LLM:
 *  - Rúbrica formal (sinopsis presente, nombre de archivo no genérico).
 *  - Evaluación técnica (sample rate, clipping, clics, duración).
 *  - Penalizaciones de creatividad a partir de las DETECCIONES del LLM
 *    (el modelo dice qué escuchó y con qué confianza; la aritmética la hace el código).
 */
import type { AudioFeatures } from '../audio/features';

export type ToolId = 'pitch_shift' | 'reversa' | 'time_stretch' | 'loops' | 'filtros';
export type OverprocessingLevel = 'Leve' | 'Moderado' | 'Severo' | 'N/A';

export interface RubricConfig {
  totalPoints: number;
  formal: {
    synopsisPoints: number;
    fileNamePoints: number;
    genericNamePatterns: string[]; // regex (case-insensitive) que marcan nombres genéricos
    minSynopsisChars: number;
  };
  technical: {
    maxPoints: number;
    requiredSampleRate: number | null; // null = no exigir
    sampleRatePenalty: number;
    clippingPenalty: number;
    clickTiers: { maxClicks: number; penalty: number }[]; // ordenados ascendentemente
    duration: { minSec: number; maxSec: number; penalty: number } | null;
    /** Solo se cuentan clics con confianza ≥ este valor (0..1). */
    clickMinConfidence: number;
  };
  creative: {
    maxPoints: number;
    requiredTools: ToolId[];
    missingToolPenalty: number;
    /** Un "detectado" con confianza por debajo de este valor se considera NO detectado. */
    toolMinConfidence: number;
    overprocessingPenalty: Record<Exclude<OverprocessingLevel, 'N/A'>, number>;
  };
  bonus: { points: number; minConfidence: number };
}

export const DEFAULT_RUBRIC: RubricConfig = {
  totalPoints: 30,
  formal: {
    synopsisPoints: 2.5,
    fileNamePoints: 2.5,
    genericNamePatterns: ['^audio\\d*$', '^proyecto\\s*\\d*$', '^project\\s*\\d*$', '^untitled', '^sin\\s*t[ií]tulo', '^track\\s*\\d*$', '^pista\\s*\\d*$', '^bounce', '^export', '^mix\\s*\\d*$', '^final\\d*$', '^test\\d*$', '^prueba\\d*$', '^new\\s*recording', '^grabaci[oó]n', '^rec\\d*$', '^\\d+$'],
    minSynopsisChars: 20,
  },
  technical: {
    maxPoints: 12.5,
    requiredSampleRate: 48000,
    sampleRatePenalty: 2.5,
    clippingPenalty: 2.5,
    clickTiers: [{ maxClicks: 0, penalty: 0 }, { maxClicks: 2, penalty: 1 }, { maxClicks: 5, penalty: 2.5 }, { maxClicks: Infinity, penalty: 4 }],
    duration: { minSec: 55, maxSec: 65, penalty: 1 },
    clickMinConfidence: 0.5,
  },
  creative: {
    maxPoints: 12.5,
    requiredTools: ['pitch_shift', 'time_stretch', 'reversa', 'filtros'],
    missingToolPenalty: 2.5,
    toolMinConfidence: 0.5,
    overprocessingPenalty: { Leve: 1, Moderado: 1.75, Severo: 2.5 },
  },
  bonus: { points: 0.5, minConfidence: 0.5 },
};

export interface ScoreLine { criterio: string; puntos: number; maximo?: number; detalle: string; fuente: 'medido' | 'modelo' | 'formal' }

export interface FormalScore { total: number; max: number; lines: ScoreLine[] }
export interface TechnicalScore { total: number; max: number; lines: ScoreLine[]; clicksCounted: number }

export const isGenericFileName = (fileName: string, patterns: string[]): boolean => {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return patterns.some((p) => new RegExp(p, 'i').test(base));
};

export const scoreFormal = (fileName: string, synopsis: string, rubric: RubricConfig = DEFAULT_RUBRIC): FormalScore => {
  const hasSynopsis = synopsis.trim().length >= rubric.formal.minSynopsisChars;
  const generic = isGenericFileName(fileName, rubric.formal.genericNamePatterns);
  const lines: ScoreLine[] = [
    {
      criterio: 'Presencia de sinopsis', puntos: hasSynopsis ? rubric.formal.synopsisPoints : 0, maximo: rubric.formal.synopsisPoints, fuente: 'formal',
      detalle: hasSynopsis ? `Sinopsis presente (${synopsis.trim().length} caracteres).` : `Sinopsis ausente o demasiado corta (mínimo ${rubric.formal.minSynopsisChars} caracteres).`,
    },
    {
      criterio: 'Nombre de archivo descriptivo', puntos: generic ? 0 : rubric.formal.fileNamePoints, maximo: rubric.formal.fileNamePoints, fuente: 'formal',
      detalle: generic ? `"${fileName}" coincide con un patrón de nombre genérico.` : `"${fileName}" es un nombre descriptivo.`,
    },
  ];
  return { total: lines.reduce((s, l) => s + l.puntos, 0), max: rubric.formal.synopsisPoints + rubric.formal.fileNamePoints, lines };
};

export const scoreTechnical = (f: AudioFeatures, rubric: RubricConfig = DEFAULT_RUBRIC): TechnicalScore => {
  const t = rubric.technical;
  const lines: ScoreLine[] = [];
  let total = t.maxPoints;

  if (t.requiredSampleRate) {
    const ok = f.format.sampleRate === t.requiredSampleRate;
    const p = ok ? 0 : -t.sampleRatePenalty;
    total += p;
    lines.push({ criterio: 'Frecuencia de muestreo', puntos: p, fuente: 'medido', detalle: ok ? `${f.format.sampleRate} Hz cumple el requisito.` : `${f.format.sampleRate} Hz; se exigían ${t.requiredSampleRate} Hz.` });
    if (ok && !f.heuristics.contentAbove16k) {
      lines.push({ criterio: 'Ancho de banda real', puntos: 0, fuente: 'medido', detalle: `Sin contenido por encima de 16 kHz (ancho de banda ≈ ${f.spectrum.bandwidthHz} Hz): posible fuente a menor resolución o MP3 remuestreado. No penaliza, pero conviene revisarlo.` });
    }
  }

  const clipped = f.clipping.detected;
  const pClip = clipped ? -t.clippingPenalty : 0;
  total += pClip;
  lines.push({
    criterio: 'Clipping / distorsión digital', puntos: pClip, fuente: 'medido',
    detalle: clipped
      ? `${f.clipping.runCount} rachas de saturación (${f.clipping.clippedSamples} muestras)${f.clipping.floatOvers ? `, ${f.clipping.floatOvers} muestras > 0 dBFS` : ''}; true peak ${f.levels.truePeakDbtp} dBTP.`
      : `Sin saturación. True peak ${f.levels.truePeakDbtp} dBTP${f.clipping.interSampleOvers ? ' (por encima de −1 dBTP: riesgo de picos inter-muestra en la conversión).' : '.'}`,
  });

  const counted = f.clicks.events.filter((e) => e.confidence >= t.clickMinConfidence).length;
  const tier = t.clickTiers.find((tier) => counted <= tier.maxClicks) ?? t.clickTiers[t.clickTiers.length - 1];
  total -= tier.penalty;
  lines.push({ criterio: 'Clics y discontinuidades de edición', puntos: -tier.penalty, fuente: 'medido', detalle: counted === 0 ? 'No se detectaron clics con confianza suficiente.' : `${counted} evento(s) con confianza ≥ ${t.clickMinConfidence}.` });

  if (t.duration) {
    const d = f.format.duration;
    const ok = d >= t.duration.minSec && d <= t.duration.maxSec;
    const p = ok ? 0 : -t.duration.penalty;
    total += p;
    lines.push({ criterio: 'Duración', puntos: p, fuente: 'medido', detalle: `${d.toFixed(1)} s (rango exigido ${t.duration.minSec}–${t.duration.maxSec} s).` });
  }

  return { total: +Math.max(0, total).toFixed(2), max: t.maxPoints, lines, clicksCounted: counted };
};

export interface ToolDetection { herramienta: ToolId; detectado: boolean; confianza: number; calidad_de_uso: 'Buena' | 'Regular' | 'Mala' | 'N/A' }

export interface CreativeInputs {
  herramientas: ToolDetection[];
  sobreprocesamiento: { detectado: boolean; nivel: OverprocessingLevel; confianza: number };
  efectosExtra: { detectado: boolean; confianza: number };
}

export interface CreativeScore { total: number; max: number; lines: ScoreLine[]; bonus: number }

export const scoreCreative = (c: CreativeInputs, rubric: RubricConfig = DEFAULT_RUBRIC): CreativeScore => {
  const r = rubric.creative;
  const lines: ScoreLine[] = [];
  let total = r.maxPoints;
  for (const tool of r.requiredTools) {
    const det = c.herramientas.find((h) => h.herramienta === tool);
    const used = !!det && det.detectado && det.confianza >= r.toolMinConfidence;
    const p = used ? 0 : -r.missingToolPenalty;
    total += p;
    lines.push({
      criterio: `Herramienta: ${tool.replace('_', ' ')}`, puntos: p, fuente: 'modelo',
      detalle: !det ? 'El modelo no informó sobre esta herramienta.' : used ? `Detectada (confianza ${(det.confianza * 100).toFixed(0)} %, uso ${det.calidad_de_uso}).` : det.detectado ? `Detección con confianza insuficiente (${(det.confianza * 100).toFixed(0)} % < ${(r.toolMinConfidence * 100).toFixed(0)} %): se considera no usada. Revísalo escuchando.` : `No detectada (confianza ${(det.confianza * 100).toFixed(0)} %).`,
    });
  }
  const op = c.sobreprocesamiento;
  if (op.detectado && op.nivel !== 'N/A' && op.confianza >= r.toolMinConfidence) {
    const p = -r.overprocessingPenalty[op.nivel];
    total += p;
    lines.push({ criterio: 'Sobreprocesamiento', puntos: p, fuente: 'modelo', detalle: `Nivel ${op.nivel} (confianza ${(op.confianza * 100).toFixed(0)} %).` });
  } else {
    lines.push({ criterio: 'Sobreprocesamiento', puntos: 0, fuente: 'modelo', detalle: op.detectado ? 'Indicado con confianza insuficiente: no penaliza.' : 'No se aprecia sobreprocesamiento.' });
  }
  const bonus = c.efectosExtra.detectado && c.efectosExtra.confianza >= rubric.bonus.minConfidence ? rubric.bonus.points : 0;
  return { total: +Math.max(0, total).toFixed(2), max: r.maxPoints, lines, bonus };
};

export const computeFinal = (formal: number, technical: number, creative: number, bonus: number, rubric: RubricConfig = DEFAULT_RUBRIC): number =>
  +Math.min(rubric.totalPoints + rubric.bonus.points, formal + technical + creative + bonus).toFixed(2);
