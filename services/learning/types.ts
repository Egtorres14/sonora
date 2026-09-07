import type { AudioFeatures } from '../audio/features';
export type EffectId = 'pitch_shift' | 'time_stretch' | 'reversa' | 'filtros' | 'loops';
export type Label = 'unknown' | 'present' | 'absent';
export interface TrainingSample { id: string; sourceGroup: string; origin: 'real' | 'synthetic'; features: AudioFeatures; labels: Record<EffectId, Label> }
export interface ConfusionCounts { truePositive: number; trueNegative: number; falsePositive: number; falseNegative: number }
export interface ValidationMetrics { confusion: ConfusionCounts; precision: number | null; recall: number; balancedAccuracy: number; evaluatedSamples: number; evaluatedGroups: number; folds: number }
export interface Readiness { effect: EffectId; eligible: boolean; reason: string; labeledRealSamples: number; positiveSamples: number; negativeSamples: number; distinctGroups: number; positiveGroups: number; negativeGroups: number }
export interface LocalEffectModel { effect: EffectId; classifier: unknown; validation: ValidationMetrics; sampleIds: string[]; groupIds: string[]; sampleCount: number; groupCount: number; positiveSamples: number; negativeSamples: number }
export interface LocalModel { version: string; featureVersion: string; trainedAt: string; trainingSampleIds: string[]; trainingGroupIds: string[]; effects: Partial<Record<EffectId, LocalEffectModel>> }
export interface Prediction { effect: EffectId; predicted: boolean | null; voteShare: number | null; explanation: string; validation: ValidationMetrics | null }
export interface GroupFold { trainIndices: number[]; testIndices: number[]; trainGroups: string[]; testGroups: string[] }
