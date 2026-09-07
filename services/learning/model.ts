import { RandomForestClassifier } from 'ml-random-forest';
import { describeAudio, DESCRIPTOR_VERSION } from './descriptors';
import type { AudioFeatures } from '../audio/features';
import type { TrainingSample, EffectId, GroupFold, Readiness, LocalModel, Prediction, ConfusionCounts } from './types';

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

export const trainingReadiness = (samples: TrainingSample[]): Readiness[] => effects.map(effect => {
  const rows = labeled(samples, effect), positives = rows.filter(s => s.labels[effect] === 'present'), negatives = rows.filter(s => s.labels[effect] === 'absent');
  const distinctGroups = new Set(rows.map(group)).size, positiveGroups = new Set(positives.map(group)).size, negativeGroups = new Set(negatives.map(group)).size;
  const enough = rows.length >= 12 && distinctGroups >= 6 && positiveGroups >= 3 && negativeGroups >= 3;
  const validFolds = enough && createGroupDisjointFolds(samples, effect).every(f => f.testIndices.length > 0 && new Set(f.trainIndices.map(i => samples[i].labels[effect])).size === 2);
  return { effect, eligible: !!validFolds, reason: validFolds ? 'Lista para una validación inicial; todavía no demuestra robustez.' : `Necesita 12 muestras reales, 6 orígenes y presencia/ausencia en al menos 3 orígenes por clase. Asigna el grupo de origen.`, labeledRealSamples: rows.length, positiveSamples: positives.length, negativeSamples: negatives.length, distinctGroups, positiveGroups, negativeGroups };
});

const fit = (rows: TrainingSample[], effect: EffectId) => {
  const classifier = new RandomForestClassifier({ seed: 42, maxFeatures: 0.7, replacement: false, nEstimators: 40, useSampleBagging: true, noOOB: true, treeOptions: { maxDepth: 8, minNumSamples: 2 } });
  classifier.train(rows.map(s => describeAudio(s.features)), rows.map(s => s.labels[effect] === 'present' ? 1 : 0));
  return classifier;
};

export const trainLocalModel = (samples: TrainingSample[]): LocalModel => {
  validateSamples(samples);
  const ready = trainingReadiness(samples).filter(r => r.eligible);
  if (!ready.length) throw new Error('Todavía no hay suficientes muestras reales etiquetadas y agrupadas. Consulta los requisitos por herramienta.');
  const model: LocalModel = { version: '1', featureVersion: DESCRIPTOR_VERSION, trainedAt: new Date().toISOString(), trainingSampleIds: [], trainingGroupIds: [], effects: {} };
  for (const r of ready) {
    const rows = labeled(samples, r.effect);
    const confusion: ConfusionCounts = { truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0 };
    for (const fold of createGroupDisjointFolds(samples, r.effect)) {
      const classifier = fit(fold.trainIndices.map(i => samples[i]), r.effect);
      const testRows = fold.testIndices.map(i => samples[i]);
      const predicted = classifier.predict(testRows.map(s => describeAudio(s.features)));
      testRows.forEach((s, i) => { const positive = s.labels[r.effect] === 'present'; confusion[positive ? predicted[i] === 1 ? 'truePositive' : 'falseNegative' : predicted[i] === 1 ? 'falsePositive' : 'trueNegative']++; });
    }
    const { truePositive: tp, trueNegative: tn, falsePositive: fp, falseNegative: fn } = confusion;
    model.effects[r.effect] = { effect: r.effect, classifier: fit(rows, r.effect).toJSON(), sampleIds: rows.map(s => s.id), groupIds: [...new Set(rows.map(group))], sampleCount: rows.length, groupCount: r.distinctGroups, positiveSamples: r.positiveSamples, negativeSamples: r.negativeSamples,
      validation: { confusion, precision: tp + fp ? tp / (tp + fp) : null, recall: tp / (tp + fn), balancedAccuracy: (tp / (tp + fn) + tn / (tn + fp)) / 2, evaluatedSamples: rows.length, evaluatedGroups: r.distinctGroups, folds: 3 },
    };
  }
  model.trainingSampleIds = [...new Set(Object.values(model.effects).flatMap(e => e!.sampleIds))];
  model.trainingGroupIds = [...new Set(Object.values(model.effects).flatMap(e => e!.groupIds))];
  return model;
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
