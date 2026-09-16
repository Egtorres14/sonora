import { describe, expect, it } from 'vitest';
import { modelFingerprint, modelsDiffer } from '../scripts/contrib/model-fingerprint';
import type { LocalModel, ValidationMetrics } from '../services/learning/types';

const validation = (balancedAccuracy: number, truePositive = 5): ValidationMetrics => ({
  confusion: { truePositive, trueNegative: 5, falsePositive: 1, falseNegative: 1 },
  precision: 0.83, recall: 0.83, balancedAccuracy, evaluatedSamples: 12, evaluatedGroups: 6, folds: 3,
});

const model = (patch: Partial<LocalModel> = {}): LocalModel => ({
  version: '1', featureVersion: '2.1.0/spectrum-temporal-v2', trainedAt: '2026-09-08T01:02:15.165Z',
  trainingSampleIds: ['a', 'b', 'c'], trainingGroupIds: ['g1', 'g2'],
  effects: { reversa: { effect: 'reversa', classifier: { arboles: [1, 2, 3] }, sampleIds: ['a', 'b'], groupIds: ['g1'], sampleCount: 2, groupCount: 1, positiveSamples: 1, negativeSamples: 1, validation: validation(0.62) } },
  ...patch,
});

describe('Huella del modelo publicado', () => {
  it('reentrenar con los mismos datos y resultados no cuenta como cambio', () => {
    expect(modelsDiffer(model(), model({ trainedAt: '2026-09-16T04:23:47.697Z' }))).toBe(false);
  });

  it('ignora cómo se serializa el bosque si la validación no cambia', () => {
    const reserialized = model();
    reserialized.effects.reversa = { ...reserialized.effects.reversa!, classifier: { arboles: [3, 2, 1], extra: true } };
    expect(modelsDiffer(model(), reserialized)).toBe(false);
  });

  it('ignora el orden en que se listan muestras y orígenes', () => {
    expect(modelsDiffer(model(), model({ trainingSampleIds: ['c', 'a', 'b'], trainingGroupIds: ['g2', 'g1'] }))).toBe(false);
  });

  it('detecta un cambio en la validación de una herramienta', () => {
    const better = model();
    better.effects.reversa = { ...better.effects.reversa!, validation: validation(0.71, 6) };
    expect(modelsDiffer(model(), better)).toBe(true);
  });

  it('detecta una colección de entrenamiento distinta', () => {
    expect(modelsDiffer(model(), model({ trainingSampleIds: ['a', 'b', 'c', 'd'] }))).toBe(true);
  });

  it('detecta una herramienta nueva en el modelo', () => {
    const wider = model();
    wider.effects.loops = { ...wider.effects.reversa!, effect: 'loops' };
    expect(modelsDiffer(model(), wider)).toBe(true);
  });

  it('detecta un cambio de descriptores, que la aplicación rechazaría', () => {
    expect(modelsDiffer(model(), model({ featureVersion: '2.2.0/spectrum-temporal-v3' }))).toBe(true);
  });

  it('la huella no incluye la fecha ni el bosque', () => {
    const fingerprint = modelFingerprint(model());
    expect(fingerprint).not.toContain('2026-09-08');
    expect(fingerprint).not.toContain('arboles');
  });
});
