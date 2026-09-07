import type { AudioFeatures } from './services/audio/features';
import type { ScoreLine, ToolId, OverprocessingLevel } from './services/scoring/rubric';
import type { ProviderId, TokenUsage } from './services/llm/types';

export type { AudioFeatures, ScoreLine, ToolId, OverprocessingLevel, ProviderId };

/** Informe técnico = características medidas (alias para compatibilidad). */
export type TechnicalReport = AudioFeatures;

export interface ClicksAndPops {
  detectado: boolean;
  cantidad_aproximada: number;
  comentarios: string;
}

export interface DigitalDistortion {
  detectado: boolean;
  comentarios: string;
}

export interface PresenceOfArtifacts {
  clics_y_pops: ClicksAndPops;
  distorsion_digital: DigitalDistortion;
  otros_problemas: string;
}

export interface AudioDuration {
  segundos: number;
  comentarios: string;
}

export interface TechnicalEvaluation {
  presencia_de_artefactos: PresenceOfArtifacts;
  duracion_audio: AudioDuration;
  calificacion_tecnica: number;
  calificacion_maxima: number;
  sample_rate: number;
  bit_depth: number;
  /** Desglose determinista de la puntuación técnica (medido en código). */
  desglose: ScoreLine[];
}

export type ToolQuality = 'Buena' | 'Regular' | 'Mala' | 'N/A';

export interface UsedTool {
  herramienta: ToolId;
  detectado: boolean;
  calidad_de_uso: ToolQuality;
  comentarios: string;
  /** 0..1, calibrada por el modelo y ponderada por el consenso. */
  confianza: number;
}

export interface Overprocessing {
  detectado: boolean;
  nivel: OverprocessingLevel;
  comentarios: string;
  confianza: number;
}

export interface CreativityAndProcessingEvaluation {
  herramientas_utilizadas: UsedTool[];
  sobreprocesamiento: Overprocessing;
  calificacion_creatividad: number;
  calificacion_maxima: number;
  desglose: ScoreLine[];
  /** Lo que el modelo dice haber escuchado/visto: sirve para verificar su juicio. */
  descripcion_sonora: string;
  coherencia_con_sinopsis: { puntuacion: number; comentarios: string };
}

export interface RubricItem {
  puntos_obtenidos: number;
  puntos_posibles: number;
  comentarios: string;
}

export interface RubricEvaluation {
  nombre_y_sinopsis: RubricItem;
  presencia_sinopsis: RubricItem;
}

export interface SummaryAndFinalRating {
  comentarios_generales: string;
  calificacion_final: number;
  calificacion_maxima: number;
  fortalezas: string[];
  mejoras: string[];
  limitaciones: string;
}

export interface BonusPoints {
  detectado: boolean;
  comentarios: string;
  puntos: number;
  confianza: number;
  cuales: string[];
}

export interface EvaluationMeta {
  provider: ProviderId;
  providerLabel: string;
  model: string;
  modelLabel: string;
  /** Qué recibió el modelo */
  modalidad: 'audio' | 'audio + espectrograma' | 'espectrograma + métricas';
  runs: number;
  /** 0..1; null cuando no hay varias ejecuciones que comparar. */
  agreement: number | null;
  disputed: string[];
  estimatedCostUsd: number;
  usage: TokenUsage;
  elapsedMs: number;
  failures: string[];
  warnings: string[];
  evaluatedAt: string;
}

export interface AudioEvaluation {
  nombre_archivo: string;
  evaluacion_rubrica: RubricEvaluation;
  evaluacion_tecnica: TechnicalEvaluation;
  evaluacion_creatividad_y_procesamiento: CreativityAndProcessingEvaluation;
  puntos_extra: BonusPoints;
  resumen_y_calificacion_final: SummaryAndFinalRating;
  meta: EvaluationMeta;
}
