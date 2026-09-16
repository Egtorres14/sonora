import { describe, expect, it } from 'vitest';
import { exportDataset, parseDataset } from '../services/library';
import { calculateReview, createReview, type ReviewRecord } from '../services/review';
import { extractFeatures, FEATURES_VERSION } from '../services/audio/features';
import { parseFeatureVersion } from '../services/audio/version';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(48000)], 48000))!);
const current = parseFeatureVersion(FEATURES_VERSION)!;
const v = (major: number, minor: number, patch: number) => `${major}.${minor}.${patch}`;
/** Mismos campos, otra versión: simula un registro medido por una versión anterior del DSP. */
const atVersion = (version: string): ReviewRecord => {
  const record = createReview('c'.repeat(64), 'antigua.wav', features);
  return { ...record, features: { ...record.features, version, analysis: { ...record.features.analysis, version } } };
};
const roundtrip = (record: ReviewRecord) => parseDataset(exportDataset([record]));

describe('Importar colecciones de versiones anteriores', () => {
  it('acepta una versión menor anterior de la misma mayor y conserva su versión', () => {
    const older = v(current.major, Math.max(0, current.minor - 1), 0);
    const restored = roundtrip(atVersion(older));
    expect(restored[0].features.version).toBe(older);
  });

  it('acepta un parche distinto', () => {
    expect(roundtrip(atVersion(v(current.major, current.minor, current.patch + 2)))).toHaveLength(1);
  });

  it('rechaza otra versión mayor, en cualquier dirección', () => {
    expect(() => roundtrip(atVersion(v(current.major - 1, 9, 0)))).toThrow();
    expect(() => roundtrip(atVersion(v(current.major + 1, 0, 0)))).toThrow();
  });

  it('rechaza una versión menor posterior a la del código', () => {
    expect(() => roundtrip(atVersion(v(current.major, current.minor + 1, 0)))).toThrow();
  });

  it('un registro antiguo puntúa igual que uno actual con las mismas medidas', () => {
    const older = atVersion(v(current.major, 0, 0));
    const now = createReview('c'.repeat(64), 'antigua.wav', features);
    expect(calculateReview(older).technical.total).toBe(calculateReview(now).technical.total);
    expect(calculateReview(older).formal.total).toBe(calculateReview(now).formal.total);
  });
});
