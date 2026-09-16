import { describe, expect, it } from 'vitest';
import { splitByFeatureVersion, trainLocalModel, trainingReadiness } from '../services/learning/model';
import { createReview, type ReviewRecord } from '../services/review';
import { extractFeatures, FEATURES_VERSION } from '../services/audio/features';
import { parseFeatureVersion } from '../services/audio/version';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const base = extractFeatures(decodePcm(encodeWav16([new Float32Array(4800)], 48000))!);
const current = parseFeatureVersion(FEATURES_VERSION)!;
const OLDER = `${current.major}.0.${current.minor === 0 ? current.patch + 1 : 0}`;

/** 24 muestras reales, 12 orígenes, filtros presente/ausente separable por espectro (como tests/learning.test.ts). */
const corpus = (): ReviewRecord[] => Array.from({ length: 24 }, (_, i) => {
  const positive = i % 2 === 0;
  const r = createReview(i.toString(16).padStart(64, '0'), `muestra-${i}.wav`, { ...base, spectrum: { ...base.spectrum, flatness: positive ? 0.9 : 0.1, centroidHz: positive ? 6000 : 200, ltas: base.spectrum.ltas.map((b, j) => ({ ...b, db: positive ? -j : j - 48 })) } });
  return { ...r, sourceGroup: `origen-${Math.floor(i / 2)}`, labels: { ...r.labels, filtros: positive ? 'present' as const : 'absent' as const } };
});
const age = (r: ReviewRecord): ReviewRecord => ({ ...r, features: { ...r.features, version: OLDER, analysis: { ...r.features.analysis, version: OLDER } } });

describe('Entrenar con registros de versiones anteriores en la colección', () => {
  it('separa lo entrenable de lo que necesita reanálisis sin mutar', () => {
    const all = corpus().map((r, i) => (i < 4 ? age(r) : r));
    const { current: now, stale } = splitByFeatureVersion(all);
    expect(now).toHaveLength(20);
    expect(stale).toHaveLength(4);
    expect(all).toHaveLength(24);
    expect(stale.every(r => r.features.version === OLDER)).toBe(true);
  });

  it('sin registros antiguos, todo es entrenable', () => {
    expect(splitByFeatureVersion(corpus()).stale).toEqual([]);
  });

  it('un registro antiguo hacía fallar el entrenamiento entero; con la separación, entrena', () => {
    const all = corpus().map((r, i) => (i < 2 ? age(r) : r));
    expect(() => trainLocalModel(all)).toThrow(/incompatible/i);
    const model = trainLocalModel(splitByFeatureVersion(all).current);
    expect(model.effects.filtros).toBeDefined();
    expect(model.trainingSampleIds).toHaveLength(22);
  });

  it('la cobertura solo cuenta lo entrenable', () => {
    const all = corpus().map((r, i) => (i < 6 ? age(r) : r));
    const filtros = trainingReadiness(splitByFeatureVersion(all).current).find(r => r.effect === 'filtros')!;
    expect(filtros.labeledRealSamples).toBe(18);
  });
});
