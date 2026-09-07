import { describe, expect, it } from 'vitest';
import { createGroupDisjointFolds, trainLocalModel, predictLocalModel, trainingReadiness } from '../services/learning/model';
import { createReview } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const base = extractFeatures(decodePcm(encodeWav16([new Float32Array(4800)], 48000))!);
const corpus = () => Array.from({ length: 24 }, (_, i) => {
  const positive = i % 2 === 0;
  const r = createReview(i.toString(16).padStart(64, '0'), `muestra-${i}.wav`, { ...base, spectrum: { ...base.spectrum, flatness: positive ? 0.9 : 0.1, centroidHz: positive ? 6000 : 200, ltas: base.spectrum.ltas.map((b, j) => ({ ...b, db: positive ? -j : j - 48 })) } });
  return { ...r, sourceGroup: `origen-${Math.floor(i / 2)}`, labels: { ...r.labels, filtros: positive ? 'present' as const : 'absent' as const } };
});
describe('Modelo local con validación independiente por origen', () => {
  it('rechaza una colección vacía y no entrena con demos', () => {
    expect(() => trainLocalModel([])).toThrow();
    expect(trainingReadiness(corpus().map(r => ({ ...r, origin: 'synthetic' as const }))).every(r => !r.eligible)).toBe(true);
  });
  it('excluye etiquetas desconocidas y exige diversidad de grupos por clase', () => {
    expect(trainingReadiness(corpus()).find(r => r.effect === 'reversa')?.labeledRealSamples).toBe(0);
    expect(trainingReadiness(corpus().map(r => ({ ...r, sourceGroup: 'unico' }))).every(r => !r.eligible)).toBe(true);
    expect(() => trainLocalModel([corpus()[0], corpus()[0]])).toThrow(/duplicad/i);
  });
  it('ningún origen aparece a ambos lados de una partición', () => {
    const folds = createGroupDisjointFolds(corpus(), 'filtros');
    expect(folds).toHaveLength(3);
    for (const f of folds) expect(f.trainGroups.filter(g => f.testGroups.includes(g))).toEqual([]);
    expect(new Set(folds.flatMap(f => f.testIndices)).size).toBe(24);
  });
  it('evalúa datos retenidos y conserva predicciones tras serializar', () => {
    const data = corpus();
    const model = trainLocalModel(data);
    const metrics = model.effects.filtros!.validation;
    expect(metrics.evaluatedSamples).toBe(24);
    expect(metrics.evaluatedGroups).toBe(12);
    expect(metrics.balancedAccuracy).toBeGreaterThan(0.8);
    const restored = JSON.parse(JSON.stringify(model));
    expect(predictLocalModel(restored, data[0].features).find(p => p.effect === 'filtros')?.predicted).toBe(true);
    expect(predictLocalModel(restored, data[1].features).find(p => p.effect === 'filtros')?.predicted).toBe(false);
    expect(predictLocalModel(restored, data[0].features).find(p => p.effect === 'reversa')?.predicted).toBeNull();
  });
  it('rechaza descriptores estructuralmente inválidos y versiones mezcladas', () => {
    const bad = corpus(); bad[0].features = { ...bad[0].features, version: 'desconocida' };
    expect(() => trainLocalModel(bad)).toThrow(/versi/i);
  });
});
