/**
 * Orquestador: métricas medidas → puntuación determinista → juicio subjetivo del LLM
 * (con consenso) → puntuación creativa en código → informe final.
 */
import type { AudioEvaluation } from '../types';
import type { AnalyzedAudio } from './audio';
import { formatTimestamp } from './audio/features';
import { prepareModelAudio } from './audio/prepare';
import { renderSpectrogramPng, renderWaveformPng } from './audio/spectrogram';
import { DEFAULT_RUBRIC, computeFinal, scoreCreative, scoreFormal, scoreTechnical, type RubricConfig } from './scoring/rubric';
import { PROVIDER_LABELS, findModel, runAssessment, type EvaluationInput, type RunConfig } from './llm';
import { ProviderError } from './llm/types';

export interface EvaluateProjectArgs {
  fileName: string;
  analyzed: AnalyzedAudio;
  synopsis: string;
  context: string;
  rubric?: RubricConfig;
  llm: RunConfig;
  onStage?: (stage: string) => void;
}

export const evaluateProject = async (args: EvaluateProjectArgs): Promise<AudioEvaluation> => {
  const rubric = args.rubric ?? DEFAULT_RUBRIC;
  const { analyzed, fileName } = args;
  const f = analyzed.features;
  const model = findModel(args.llm.model);
  if (!model) throw new ProviderError(`Modelo no reconocido: ${args.llm.model}`, args.llm.provider, 'bad-request');

  args.onStage?.('Puntuando la parte formal y técnica…');
  const formal = scoreFormal(fileName, args.synopsis, rubric);
  const technical = scoreTechnical(f, rubric);

  const input: EvaluationInput = { fileName, synopsis: args.synopsis, context: args.context, features: f, rubric };
  const warnings = [...f.analysis.warnings];

  if (model.inputs.audio) {
    args.onStage?.('Preparando el audio para el modelo (mono, 16 kHz)…');
    input.audio = await prepareModelAudio(analyzed.channels, analyzed.sampleRate);
  }
  if (model.inputs.image) {
    args.onStage?.('Generando el espectrograma…');
    input.spectrogram = renderSpectrogramPng(analyzed.channels, analyzed.sampleRate);
    if (model.provider === 'anthropic') input.waveform = renderWaveformPng(analyzed.channels, analyzed.sampleRate);
  }
  const modalidad: AudioEvaluation['meta']['modalidad'] = model.inputs.audio && model.inputs.image ? 'audio + espectrograma' : model.inputs.audio ? 'audio' : 'espectrograma + métricas';

  args.onStage?.(`Consultando a ${model.label}${args.llm.runs > 1 ? ` (${args.llm.runs} ejecuciones en paralelo)` : ''}…`);
  const run = await runAssessment(input, args.llm);
  const a = run.assessment;

  const creative = scoreCreative(
    {
      herramientas: a.herramientas.map((h) => ({ herramienta: h.herramienta, detectado: h.detectado, confianza: h.confianza, calidad_de_uso: h.calidad_de_uso })),
      sobreprocesamiento: { detectado: a.sobreprocesamiento.detectado, nivel: a.sobreprocesamiento.nivel, confianza: a.sobreprocesamiento.confianza },
      efectosExtra: { detectado: a.efectos_extra.detectado, confianza: a.efectos_extra.confianza },
    },
    rubric,
  );
  const final = computeFinal(formal.total, technical.total, creative.total, creative.bonus, rubric);

  const clickEvents = f.clicks.events.filter((e) => e.confidence >= rubric.technical.clickMinConfidence);
  const clickList = clickEvents.slice(0, 15).map((e) => `${formatTimestamp(e.time)}${e.kind === 'discontinuity' ? ' (corte)' : ''}`).join(', ');
  const clipList = f.clipping.timestamps.slice(0, 10).map(formatTimestamp).join(', ');

  return {
    nombre_archivo: fileName,
    evaluacion_rubrica: {
      presencia_sinopsis: { puntos_obtenidos: formal.lines[0].puntos, puntos_posibles: formal.lines[0].maximo ?? 0, comentarios: formal.lines[0].detalle },
      nombre_y_sinopsis: { puntos_obtenidos: formal.lines[1].puntos, puntos_posibles: formal.lines[1].maximo ?? 0, comentarios: formal.lines[1].detalle },
    },
    evaluacion_tecnica: {
      presencia_de_artefactos: {
        clics_y_pops: {
          detectado: clickEvents.length > 0,
          cantidad_aproximada: clickEvents.length,
          comentarios: clickEvents.length ? `Se detectaron ${clickEvents.length} clic(s)/corte(s) de edición en: ${clickList}${clickEvents.length > 15 ? '…' : ''}. Revisa esos puntos y aplica crossfades o edita en cruces por cero.` : 'No se detectaron clics ni cortes de edición.',
        },
        distorsion_digital: {
          detectado: f.clipping.detected,
          comentarios: f.clipping.detected
            ? `Saturación digital: ${f.clipping.runCount} rachas de muestras a fondo de escala (${f.clipping.clippedSamples} muestras)${clipList ? `, a partir de ${clipList}` : ''}. True peak ${f.levels.truePeakDbtp} dBTP. Baja la ganancia de salida o usa un limitador con techo a −1 dBTP.`
            : `Sin saturación. True peak ${f.levels.truePeakDbtp} dBTP, sonoridad integrada ${f.levels.integratedLufs} LUFS.${f.clipping.interSampleOvers ? ' Los picos superan −1 dBTP: riesgo de distorsión en conversores y codecs.' : ''}`,
        },
        otros_problemas: [
          f.levels.dcOffsetWarning ? `DC offset apreciable (${f.levels.dcOffset.join(' / ')}).` : '',
          f.silence.leadingSec > 1 ? `Silencio inicial de ${f.silence.leadingSec} s.` : '',
          f.silence.trailingSec > 1 ? `Silencio final de ${f.silence.trailingSec} s.` : '',
          f.silence.gaps.length ? `${f.silence.gaps.length} hueco(s) de silencio interno ≥ 100 ms.` : '',
          f.stereo?.isDualMono ? 'El archivo es dual mono (L = R): no hay imagen estéreo.' : '',
          f.stereo && f.stereo.correlation < 0 ? `Correlación L/R negativa (${f.stereo.correlation}): posibles problemas de fase en mono.` : '',
          !f.heuristics.contentAbove16k && f.format.sampleRate >= 44100 ? `Sin contenido por encima de 16 kHz (ancho de banda ≈ ${f.spectrum.bandwidthHz} Hz): posible material de origen a menor resolución.` : '',
        ].filter(Boolean).join(' ') || 'Sin otros problemas técnicos medibles.',
      },
      duracion_audio: { segundos: f.format.duration, comentarios: technical.lines.find((l) => l.criterio === 'Duración')?.detalle ?? '' },
      calificacion_tecnica: technical.total,
      calificacion_maxima: technical.max,
      sample_rate: f.format.sampleRate,
      bit_depth: f.format.bitDepth,
      desglose: technical.lines,
    },
    evaluacion_creatividad_y_procesamiento: {
      herramientas_utilizadas: a.herramientas.map((h) => ({ herramienta: h.herramienta, detectado: h.detectado, calidad_de_uso: h.calidad_de_uso, comentarios: h.evidencia, confianza: h.confianza })),
      sobreprocesamiento: { detectado: a.sobreprocesamiento.detectado, nivel: a.sobreprocesamiento.nivel, comentarios: a.sobreprocesamiento.comentarios, confianza: a.sobreprocesamiento.confianza },
      calificacion_creatividad: creative.total,
      calificacion_maxima: creative.max,
      desglose: creative.lines,
      descripcion_sonora: a.descripcion_sonora,
      coherencia_con_sinopsis: a.coherencia_con_sinopsis,
    },
    puntos_extra: { detectado: a.efectos_extra.detectado, comentarios: a.efectos_extra.comentarios, puntos: creative.bonus, confianza: a.efectos_extra.confianza, cuales: a.efectos_extra.cuales },
    resumen_y_calificacion_final: {
      comentarios_generales: a.comentarios_generales,
      calificacion_final: final,
      calificacion_maxima: rubric.totalPoints,
      fortalezas: a.fortalezas,
      mejoras: a.mejoras,
      limitaciones: a.limitaciones,
    },
    meta: {
      provider: model.provider,
      providerLabel: PROVIDER_LABELS[model.provider],
      model: model.id,
      modelLabel: model.label,
      modalidad,
      runs: run.runs,
      agreement: run.agreement,
      disputed: run.disputed,
      estimatedCostUsd: run.estimatedCostUsd,
      usage: run.usage,
      elapsedMs: run.elapsedMs,
      failures: run.failures.map((e) => e.message),
      warnings,
      evaluatedAt: new Date().toISOString(),
    },
  };
};
