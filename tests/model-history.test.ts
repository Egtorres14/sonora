import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createLibrary, exportDataset, parseDataset } from '../services/library';
import { createReview, updateReview } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';
import type { LocalModel } from '../services/learning/types';

const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(48000)], 48000))!);
const record = () => createReview('e'.repeat(64), 'muestra.wav', features);

const model = (trainedAt: string, balancedAccuracy: number): LocalModel => ({
  version: '1', featureVersion: '2.1.0/spectrum-temporal-v2', trainedAt,
  trainingSampleIds: ['a', 'b'], trainingGroupIds: ['campana-01'],
  effects: { reversa: { effect: 'reversa', classifier: {}, sampleIds: ['a', 'b'], groupIds: ['campana-01'], sampleCount: 2, groupCount: 1, positiveSamples: 1, negativeSamples: 1, validation: { confusion: { truePositive: 1, trueNegative: 1, falsePositive: 0, falseNegative: 0 }, precision: 1, recall: 1, balancedAccuracy, evaluatedSamples: 2, evaluatedGroups: 1, folds: 3 } } },
});

describe('Historial de entrenamientos', () => {
  it('conserva un resumen por entrenamiento aunque el modelo se sustituya', async () => {
    const db = createLibrary(`test-${crypto.randomUUID()}`);
    await db.saveModel(model('2026-09-01T10:00:00.000Z', 0.61));
    await db.saveModel(model('2026-09-08T10:00:00.000Z', 0.74));
    const history = await db.modelHistory();
    expect(history.map(h => h.effects.reversa?.balancedAccuracy)).toEqual([0.61, 0.74]);
    expect((await db.model())?.trainedAt).toBe('2026-09-08T10:00:00.000Z');
  });

  it('reentrenar en el mismo instante no duplica la entrada', async () => {
    const db = createLibrary(`test-${crypto.randomUUID()}`);
    await db.saveModel(model('2026-09-01T10:00:00.000Z', 0.61));
    await db.saveModel(model('2026-09-01T10:00:00.000Z', 0.68));
    const history = await db.modelHistory();
    expect(history).toHaveLength(1);
    expect(history[0].effects.reversa?.balancedAccuracy).toBe(0.68);
  });

  it('una biblioteca sin historial previo se abre sin perder las muestras', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const first = createLibrary(name);
    await first.save({ ...record(), notes: 'Revisado' }, new Blob(['audio']));
    const reopened = createLibrary(name);
    expect(await reopened.modelHistory()).toEqual([]);
    expect((await reopened.list())[0].notes).toBe('Revisado');
  });
});

describe('Marca de entrenamiento en la exportación', () => {
  it('viaja en el JSON y sobrevive a una vuelta completa', () => {
    const labelled = updateReview(record(), { labels: { ...record().labels, reversa: 'present' } });
    const restored = parseDataset(exportDataset([labelled]))[0];
    expect(restored.trainingUpdatedAt).toBe(labelled.trainingUpdatedAt);
  });

  it('una colección anterior a este campo sigue siendo válida', () => {
    const legacy = JSON.parse(exportDataset([record()]));
    delete legacy.records[0].trainingUpdatedAt;
    const restored = parseDataset(JSON.stringify(legacy));
    expect(restored[0].trainingUpdatedAt).toBeUndefined();
    expect(restored[0].id).toBe(record().id);
  });
});
