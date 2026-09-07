/**
 * Rúbrica editable por el profesor, guardada en el navegador y validada al cargar.
 * Los tramos de clics se guardan con `maxClicks: null` para "sin límite" porque JSON no admite Infinity.
 */
import { z } from 'zod';
import { DEFAULT_RUBRIC, type RubricConfig, type ToolId } from './scoring/rubric';

const RUBRIC_KEY = 'sonora.rubric.v1';
const memory = new Map<string, string>();
const store = {
  get(key: string) { try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : memory.get(key) ?? null; } catch { return memory.get(key) ?? null; } },
  set(key: string, value: string) { try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); else memory.set(key, value); } catch { memory.set(key, value); } },
  remove(key: string) { try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key); } catch { /* */ } memory.delete(key); },
};

const points = z.number().finite().min(0).max(100);
const TOOLS: ToolId[] = ['pitch_shift', 'time_stretch', 'reversa', 'filtros', 'loops'];

export const StoredRubricSchema = z.object({
  formal: z.object({ synopsisPoints: points, fileNamePoints: points, genericNamePatterns: z.array(z.string().max(200)).max(100), minSynopsisChars: z.number().int().min(0).max(5000) }),
  technical: z.object({
    maxPoints: points,
    requiredSampleRate: z.number().int().min(8000).max(384000).nullable(),
    sampleRatePenalty: points,
    clippingPenalty: points,
    clickTiers: z.array(z.object({ maxClicks: z.number().int().min(0).nullable(), penalty: points })).min(1).max(8),
    duration: z.object({ minSec: z.number().min(0).max(86400), maxSec: z.number().min(0).max(86400), penalty: points }).nullable(),
    clickMinConfidence: z.number().min(0).max(1),
  }),
  creative: z.object({
    maxPoints: points,
    requiredTools: z.array(z.enum(TOOLS as [ToolId, ...ToolId[]])).max(5),
    missingToolPenalty: points,
    toolMinConfidence: z.number().min(0).max(1),
    overprocessingPenalty: z.object({ Leve: points, Moderado: points, Severo: points }),
  }),
  bonus: z.object({ points, minConfidence: z.number().min(0).max(1) }),
});
export type StoredRubric = z.infer<typeof StoredRubricSchema>;

export const toStored = (r: RubricConfig): StoredRubric => ({
  formal: { ...r.formal },
  technical: { ...r.technical, clickTiers: r.technical.clickTiers.map((t) => ({ maxClicks: Number.isFinite(t.maxClicks) ? t.maxClicks : null, penalty: t.penalty })), duration: r.technical.duration ? { ...r.technical.duration } : null },
  creative: { ...r.creative, requiredTools: [...r.creative.requiredTools], overprocessingPenalty: { ...r.creative.overprocessingPenalty } },
  bonus: { ...r.bonus },
});

export const rubricTotal = (r: { formal: { synopsisPoints: number; fileNamePoints: number }; technical: { maxPoints: number }; creative: { maxPoints: number } }) =>
  +(r.formal.synopsisPoints + r.formal.fileNamePoints + r.technical.maxPoints + r.creative.maxPoints).toFixed(2);

/** Convierte una rúbrica almacenada en `RubricConfig`, validando y ordenando los tramos de clics. */
export const fromStored = (raw: unknown): RubricConfig => {
  const s = StoredRubricSchema.parse(raw);
  const tiers = s.technical.clickTiers.map((t) => ({ maxClicks: t.maxClicks ?? Infinity, penalty: t.penalty })).sort((a, b) => a.maxClicks - b.maxClicks);
  if (!Number.isFinite(tiers[tiers.length - 1].maxClicks)) { /* ya hay tramo abierto */ } else tiers.push({ maxClicks: Infinity, penalty: tiers[tiers.length - 1].penalty });
  if (s.technical.duration && s.technical.duration.minSec > s.technical.duration.maxSec) throw new Error('La duración mínima no puede superar a la máxima.');
  const config: RubricConfig = {
    totalPoints: rubricTotal(s),
    formal: { ...s.formal },
    technical: { ...s.technical, clickTiers: tiers, duration: s.technical.duration },
    creative: { ...s.creative },
    bonus: { ...s.bonus },
  };
  return config;
};

export const loadRubric = (): RubricConfig => {
  const raw = store.get(RUBRIC_KEY);
  if (!raw) return DEFAULT_RUBRIC;
  try { return fromStored(JSON.parse(raw)); } catch { return DEFAULT_RUBRIC; }
};

export const saveRubric = (r: RubricConfig): RubricConfig => {
  const config = fromStored(toStored(r)); // valida
  store.set(RUBRIC_KEY, JSON.stringify(toStored(config)));
  return config;
};

export const resetRubric = (): RubricConfig => { store.remove(RUBRIC_KEY); return DEFAULT_RUBRIC; };
export const isDefaultRubric = (r: RubricConfig) => JSON.stringify(toStored(r)) === JSON.stringify(toStored(DEFAULT_RUBRIC));
