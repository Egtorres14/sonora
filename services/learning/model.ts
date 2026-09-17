import { RandomForestClassifier } from 'ml-random-forest';
import { describeAudio, DESCRIPTOR_VERSION } from './descriptors';
import type { AudioFeatures } from '../audio/features';
import type { ReviewRecord } from '../review';
import type { TrainingSample, EffectId, GroupFold, Readiness, LocalModel, ModelSnapshot, Prediction, ConfusionCounts, ValidationMetrics, HoldoutSet } from './types';
import { isCurrentFeatures } from '../audio/version';

const effects: EffectId[] = ['pitch_shift', 'time_stretch', 'reversa', 'filtros', 'loops'];
const group = (s: TrainingSample) => s.sourceGroup.trim().toLowerCase();
const labeled = (samples: TrainingSample[], effect: EffectId) => samples.filter(s => s.origin === 'real' && group(s) && s.labels[effect] !== 'unknown');

const validateSamples = (samples: TrainingSample[]) => {
  const ids = new Set<string>();
  for (const s of samples) {
    if (ids.has(s.id)) throw new Error('Hay muestras duplicadas. Deduplica la colección antes de entrenar.');
    ids.add(s.id);
    if (s.origin === 'real') describeAudio(s.features);
    if (effects.some(e => !['unknown', 'present', 'absent'].includes(s.labels[e]))) throw new Error('Etiquetas inválidas.');
  }
};

export const createGroupDisjointFolds = (samples: TrainingSample[], effect: EffectId): GroupFold[] => {
  const eligible = labeled(samples, effect);
  const byGroup = new Map<string, { positive: number; negative: number }>();
  for (const sample of eligible) {
    const key = group(sample), count = byGroup.get(key) ?? { positive: 0, negative: 0 };
    count[sample.labels[effect] === 'present' ? 'positive' : 'negative']++;
    byGroup.set(key, count);
  }
  const groups = [...byGroup.keys()].sort();
  const buckets: string[][] = [[], [], []];
  const counts = [[0, 0], [0, 0], [0, 0]];
  // Place larger groups first, balance class counts without splitting a source.
  groups.sort((a, b) => { const ca = byGroup.get(a)!, cb = byGroup.get(b)!; return cb.positive + cb.negative - ca.positive - ca.negative || a.localeCompare(b); });
  for (const g of groups) {
    const { positive: pos, negative: neg } = byGroup.get(g)!;
    const order = [0, 1, 2].sort((a, b) => counts[a][0] * pos + counts[a][1] * neg - counts[b][0] * pos - counts[b][1] * neg || buckets[a].length - buckets[b].length || a - b);
    buckets[order[0]].push(g); counts[order[0]][0] += pos; counts[order[0]][1] += neg;
  }
  return buckets.map(testGroups => {
    const test = new Set(testGroups), included = new Set(eligible.map(s => s.id));
    const trainIndices: number[] = [], testIndices: number[] = [];
    samples.forEach((s, i) => { if (included.has(s.id)) (test.has(group(s)) ? testIndices : trainIndices).push(i); });
    return { trainIndices, testIndices, testGroups, trainGroups: groups.filter(g => !test.has(g)) };
  });
};

/**
 * Lo que puede entrenar y lo que necesita reanálisis. `describeAudio` lanza con una versión
 * distinta, y antes bastaba un registro antiguo para que fallara todo el entrenamiento.
 * Lo usan la aplicación (LearningView) y CI (scripts/contrib/train-community.ts).
 */
export const splitByFeatureVersion = <T extends { features: { version: string } }>(records: T[]): { current: T[]; stale: T[] } => ({
  current: records.filter(r => isCurrentFeatures(r.features)),
  stale: records.filter(r => !isCurrentFeatures(r.features)),
});

export const trainingReadiness = (samples: TrainingSample[]): Readiness[] => effects.map(effect => {
  const rows = labeled(samples, effect), positives = rows.filter(s => s.labels[effect] === 'present'), negatives = rows.filter(s => s.labels[effect] === 'absent');
  const distinctGroups = new Set(rows.map(group)).size, positiveGroups = new Set(positives.map(group)).size, negativeGroups = new Set(negatives.map(group)).size;
  const enough = rows.length >= 12 && distinctGroups >= 6 && positiveGroups >= 3 && negativeGroups >= 3;
  const validFolds = enough && createGroupDisjointFolds(samples, effect).every(f => f.testIndices.length > 0 && new Set(f.trainIndices.map(i => samples[i].labels[effect])).size === 2);
  return { effect, eligible: !!validFolds, reason: validFolds ? 'Lista para una validación inicial; todavía no demuestra robustez.' : `Necesita 12 muestras reales, 6 orígenes y presencia/ausencia en al menos 3 orígenes por clase. Asigna el grupo de origen.`, labeledRealSamples: rows.length, positiveSamples: positives.length, negativeSamples: negatives.length, distinctGroups, positiveGroups, negativeGroups };
});

/**
 * `toJSON()` del bosque deja instancias dentro (TreeNode, Matrix, Float64Array). Sobreviven a
 * JSON.stringify, pero el clonado estructurado —el worker al devolver el modelo, IndexedDB al
 * guardarlo— las convierte en objetos planos que `load` no entiende y `predict` revienta con
 * «classify(...).maxRowIndex is not a function». Se serializa a JSON puro desde el principio.
 */
const serializeClassifier = (classifier: RandomForestClassifier): unknown => JSON.parse(JSON.stringify(classifier.toJSON()));

/** Hiperparámetros del bosque. Los valores por defecto se eligieron midiendo en el corpus (scripts/corpus/tune.ts). */
export interface ForestOptions { nEstimators?: number; maxDepth?: number; maxFeatures?: number; minNumSamples?: number }
export const DEFAULT_FOREST: Required<ForestOptions> = { nEstimators: 40, maxDepth: 8, maxFeatures: 0.7, minNumSamples: 2 };

const fit = (rows: TrainingSample[], effect: EffectId, options: ForestOptions = {}) => {
  const o = { ...DEFAULT_FOREST, ...options };
  const classifier = new RandomForestClassifier({ seed: 42, maxFeatures: o.maxFeatures, replacement: false, nEstimators: o.nEstimators, useSampleBagging: true, noOOB: true, treeOptions: { maxDepth: o.maxDepth, minNumSamples: o.minNumSamples } });
  const balanced = balanceClasses(rows, effect);
  classifier.train(balanced.map(s => describeAudio(s.features)), balanced.map(s => s.labels[effect] === 'present' ? 1 : 0));
  return classifier;
};

/**
 * Equilibra las clases repitiendo de forma determinista las muestras de la clase minoritaria hasta
 * igualar a la mayoritaria. Sin esto, con 1 positivo por cada 3–4 negativos el bosque aprende a decir
 * «ausente» y la sensibilidad se hunde (medido en el corpus: reversa 15 % de sensibilidad).
 */
const balanceClasses = (rows: TrainingSample[], effect: EffectId): TrainingSample[] => {
  const positive = rows.filter(s => s.labels[effect] === 'present'), negative = rows.filter(s => s.labels[effect] !== 'present');
  if (!positive.length || !negative.length) return rows;
  const [minor, major] = positive.length <= negative.length ? [positive, negative] : [negative, positive];
  const out = [...rows];
  for (let i = minor.length; i < major.length; i++) out.push(minor[i % minor.length]);
  return out;
};

export const trainLocalModel = (samples: TrainingSample[], options: ForestOptions = {}): LocalModel => {
  validateSamples(samples);
  const ready = trainingReadiness(samples).filter(r => r.eligible);
  if (!ready.length) throw new Error('Todavía no hay suficientes muestras reales etiquetadas y agrupadas. Consulta los requisitos por herramienta.');
  const model: LocalModel = { version: '1', featureVersion: DESCRIPTOR_VERSION, trainedAt: new Date().toISOString(), trainingSampleIds: [], trainingGroupIds: [], effects: {} };
  for (const r of ready) {
    const rows = labeled(samples, r.effect);
    const confusion: ConfusionCounts = { truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0 };
    for (const fold of createGroupDisjointFolds(samples, r.effect)) {
      const classifier = fit(fold.trainIndices.map(i => samples[i]), r.effect, options);
      const testRows = fold.testIndices.map(i => samples[i]);
      const predicted = classifier.predict(testRows.map(s => describeAudio(s.features)));
      testRows.forEach((s, i) => { const positive = s.labels[r.effect] === 'present'; confusion[positive ? predicted[i] === 1 ? 'truePositive' : 'falseNegative' : predicted[i] === 1 ? 'falsePositive' : 'trueNegative']++; });
    }
    const { truePositive: tp, trueNegative: tn, falsePositive: fp, falseNegative: fn } = confusion;
    model.effects[r.effect] = { effect: r.effect, classifier: serializeClassifier(fit(rows, r.effect, options)), sampleIds: rows.map(s => s.id), groupIds: [...new Set(rows.map(group))], sampleCount: rows.length, groupCount: r.distinctGroups, positiveSamples: r.positiveSamples, negativeSamples: r.negativeSamples,
      validation: { confusion, precision: tp + fp ? tp / (tp + fp) : null, recall: tp / (tp + fn), balancedAccuracy: (tp / (tp + fn) + tn / (tn + fp)) / 2, evaluatedSamples: rows.length, evaluatedGroups: r.distinctGroups, folds: 3 },
    };
  }
  model.trainingSampleIds = [...new Set(Object.values(model.effects).flatMap(e => e!.sampleIds))];
  model.trainingGroupIds = [...new Set(Object.values(model.effects).flatMap(e => e!.groupIds))];
  return model;
};

/** Fracción de orígenes que se apartan, y mínimo de orígenes para que el entrenamiento conserve los suyos (necesita 6). */
const HOLDOUT_FRACTION = 0.2;
const MIN_GROUPS_TO_FREEZE = 8;
const hash = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/**
 * Aparta orígenes enteros, nunca muestras sueltas: si una versión de una grabación entrena y otra
 * evalúa, la medición miente. La elección es determinista (hash del nombre del origen), para que la
 * misma colección dé siempre el mismo conjunto. Demos y registros sin origen no participan.
 */
export const chooseHoldout = (records: TrainingSample[], seed = 'sonora'): HoldoutSet => {
  const eligible = records.filter(r => r.origin === 'real' && group(r));
  const groups = [...new Set(eligible.map(group))];
  if (groups.length < MIN_GROUPS_TO_FREEZE) throw new Error(`Hacen falta al menos ${MIN_GROUPS_TO_FREEZE} orígenes reales para apartar un conjunto de evaluación sin dejar el entrenamiento sin datos (hay ${groups.length}).`);
  const count = Math.max(1, Math.round(groups.length * HOLDOUT_FRACTION));
  const chosen = new Set(groups.map(g => ({ g, h: hash(`${seed}:${g}`) })).sort((a, b) => a.h - b.h || a.g.localeCompare(b.g)).slice(0, count).map(x => x.g));
  return { ids: eligible.filter(r => chosen.has(group(r))).map(r => r.id), groups: [...chosen].sort(), chosenAt: new Date().toISOString() };
};

/**
 * Mide un modelo ya entrenado sobre muestras que no vio. A diferencia de `predictLocalModel`, aquí
 * no hay abstención: cada muestra cuenta como acierto o error, que es lo que hace comparable la cifra.
 */
export const evaluateHoldout = (model: LocalModel, samples: TrainingSample[]): Partial<Record<EffectId, ValidationMetrics>> => {
  const out: Partial<Record<EffectId, ValidationMetrics>> = {};
  for (const trained of Object.values(model.effects)) {
    if (!trained) continue;
    const rows = labeled(samples, trained.effect);
    if (!rows.length) continue;
    const classifier = RandomForestClassifier.load(trained.classifier as Parameters<typeof RandomForestClassifier.load>[0]);
    const votes = classifier.predictProbability(rows.map(s => describeAudio(s.features)), 1);
    const c: ConfusionCounts = { truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0 };
    rows.forEach((s, i) => { const positive = s.labels[trained.effect] === 'present', predicted = votes[i] >= 0.5; c[positive ? predicted ? 'truePositive' : 'falseNegative' : predicted ? 'falsePositive' : 'trueNegative']++; });
    const recall = c.truePositive + c.falseNegative ? c.truePositive / (c.truePositive + c.falseNegative) : 0;
    const specificity = c.trueNegative + c.falsePositive ? c.trueNegative / (c.trueNegative + c.falsePositive) : 0;
    out[trained.effect] = { confusion: c, precision: c.truePositive + c.falsePositive ? c.truePositive / (c.truePositive + c.falsePositive) : null, recall, balancedAccuracy: (recall + specificity) / 2, evaluatedSamples: rows.length, evaluatedGroups: new Set(rows.map(group)).size, folds: 0 };
  }
  return out;
};

/** Resumen comparable de un entrenamiento, sin el bosque serializado. */
export const summarizeModel = (model: LocalModel): ModelSnapshot => ({
  trainedAt: model.trainedAt,
  featureVersion: model.featureVersion,
  sampleCount: model.trainingSampleIds.length,
  groupCount: model.trainingGroupIds.length,
  effects: Object.fromEntries(Object.values(model.effects).map(e => [e!.effect, e!.validation])) as Partial<Record<EffectId, ValidationMetrics>>,
  ...(model.holdout ? { holdout: model.holdout } : {}),
});

/**
 * ¿Hay que reentrenar? Sí si el modelo se entrenó con una versión de las características distinta de
 * la actual (`DESCRIPTOR_VERSION`): `predictLocalModel` lo rechazaría igualmente, así que mejor
 * avisarlo aquí como caducado que dejar el panel de clasificación vacío sin explicación. También, si
 * una muestra usada en el entrenamiento ha desaparecido o ha cambiado en algo que el modelo aprende.
 * Escribir el feedback de un estudiante no invalida nada, y por eso se mira `trainingUpdatedAt` (con
 * `updatedAt` de respaldo en los registros antiguos).
 */
export const isModelStale = (model: LocalModel | null, records: ReviewRecord[]): boolean => {
  if (!model) return false;
  if (model.featureVersion !== DESCRIPTOR_VERSION) return true;
  const byId = new Map(records.map(r => [r.id, r]));
  return model.trainingSampleIds.some(id => {
    const record = byId.get(id);
    return !record || (record.trainingUpdatedAt ?? record.updatedAt) > model.trainedAt;
  });
};

export const predictLocalModel = (model: LocalModel, features: AudioFeatures): Prediction[] => {
  if (model.version !== '1' || model.featureVersion !== DESCRIPTOR_VERSION) throw new Error('Modelo incompatible. Vuelve a entrenarlo.');
  const vector = describeAudio(features);
  return effects.map(effect => {
    const trained = model.effects[effect];
    if (!trained) return { effect, predicted: null, voteShare: null, explanation: 'Sin un modelo entrenado para esta herramienta.', validation: null };
    const classifier = RandomForestClassifier.load(trained.classifier as Parameters<typeof RandomForestClassifier.load>[0]);
    const voteShare = classifier.predictProbability([vector], 1)[0];
    const abstain = !Number.isFinite(voteShare) || trained.validation.balancedAccuracy < 0.65 || (voteShare > 0.35 && voteShare < 0.65);
    return { effect, predicted: abstain ? null : voteShare >= 0.65, voteShare: Number.isFinite(voteShare) ? voteShare : null, explanation: abstain ? 'Resultado insuficiente para sugerir una decisión. Revisa la evidencia.' : 'Sugerencia experimental por descriptores globales. Los votos no son una probabilidad calibrada; confirma con la fuente original.', validation: trained.validation };
  });
};
