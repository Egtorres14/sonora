import { describe, expect, it, vi } from 'vitest';
import { changesTraining, createReview, updateReview, type ReviewRecord } from '../services/review';
import { isModelStale, summarizeModel } from '../services/learning/model';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';
import type { LocalModel } from '../services/learning/types';

const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(48000)], 48000))!);
const record = (id = 'd'.repeat(64)): ReviewRecord => ({ ...createReview(id, 'muestra.wav', features), sourceGroup: 'campana-01' });

const modelTrainedAfter = (records: ReviewRecord[]): LocalModel => ({
  version: '1', featureVersion: 'x', trainedAt: new Date(Date.now() + 1000).toISOString(),
  trainingSampleIds: records.map(r => r.id), trainingGroupIds: ['campana-01'], effects: {},
});

describe('Qué invalida un entrenamiento', () => {
  it('reconoce los cambios que el modelo aprende', () => {
    const base = record();
    expect(changesTraining(base, { labels: { ...base.labels, reversa: 'present' } })).toBe(true);
    expect(changesTraining(base, { sourceGroup: 'campana-02' })).toBe(true);
    expect(changesTraining(base, { origin: 'synthetic' })).toBe(true);
  });

  it('ignora lo que no cambia lo que el modelo aprende', () => {
    const base = record();
    expect(changesTraining(base, { notes: 'Buen trabajo' })).toBe(false);
    expect(changesTraining(base, { synopsis: 'Campana procesada' })).toBe(false);
    expect(changesTraining(base, { manualScore: 24 })).toBe(false);
    expect(changesTraining(base, { published: true })).toBe(false);
    // Reenviar las mismas etiquetas no es un cambio.
    expect(changesTraining(base, { labels: { ...base.labels } })).toBe(false);
  });

  it('escribir el feedback no caduca el modelo; etiquetar sí', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-01T10:00:00.000Z'));
      const base = record();
      const model: LocalModel = { ...modelTrainedAfter([base]), trainedAt: '2026-09-02T10:00:00.000Z' };

      vi.setSystemTime(new Date('2026-09-03T10:00:00.000Z'));
      const commented = updateReview(base, { notes: 'Revisa los cortes' });
      expect(commented.updatedAt > model.trainedAt).toBe(true); // el registro sí cambió
      expect(isModelStale(model, [commented])).toBe(false);     // pero no en lo que se entrenó

      const relabelled = updateReview(commented, { labels: { ...base.labels, reversa: 'present' } });
      expect(isModelStale(model, [relabelled])).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('caduca si una muestra usada en el entrenamiento ha desaparecido', () => {
    const base = record();
    expect(isModelStale(modelTrainedAfter([base]), [])).toBe(true);
  });

  it('sin modelo no hay nada que caducar', () => {
    expect(isModelStale(null, [record()])).toBe(false);
  });

  it('usa updatedAt en los registros anteriores al campo de entrenamiento', () => {
    const legacy = record();
    delete legacy.trainingUpdatedAt;
    const model: LocalModel = { ...modelTrainedAfter([legacy]), trainedAt: new Date(Date.parse(legacy.updatedAt) - 1000).toISOString() };
    expect(isModelStale(model, [legacy])).toBe(true);
  });

  it('el resumen de un entrenamiento no arrastra el bosque serializado', () => {
    const model: LocalModel = {
      ...modelTrainedAfter([record()]),
      effects: { reversa: { effect: 'reversa', classifier: { enorme: 'x'.repeat(1000) }, sampleIds: [], groupIds: [], sampleCount: 12, groupCount: 6, positiveSamples: 6, negativeSamples: 6, validation: { confusion: { truePositive: 5, trueNegative: 5, falsePositive: 1, falseNegative: 1 }, precision: 0.83, recall: 0.83, balancedAccuracy: 0.83, evaluatedSamples: 12, evaluatedGroups: 6, folds: 3 } } },
    };
    const snapshot = summarizeModel(model);
    expect(snapshot.effects.reversa?.balancedAccuracy).toBe(0.83);
    expect(snapshot.sampleCount).toBe(1);
    expect(JSON.stringify(snapshot)).not.toContain('enorme');
  });
});
