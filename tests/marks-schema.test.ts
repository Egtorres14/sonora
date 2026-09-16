import { describe, expect, it } from 'vitest';
import { exportDataset, parseDataset } from '../services/library';
import { addMark, createMark } from '../services/marks';
import { createReview, type ReviewRecord } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const DURATION = 20;
const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(48000 * DURATION)], 48000))!);
const record = (): ReviewRecord => createReview('a'.repeat(64), 'pieza.wav', features);
const withMark = (): ReviewRecord => {
  const base = record();
  const mark = { ...createMark('reversa', 12, 18, DURATION), note: 'Cola invertida antes del cambio' };
  return { ...base, ...addMark(base, mark).patch } as ReviewRecord;
};

describe('Marcas en la colección exportada', () => {
  it('sobreviven a una vuelta completa', () => {
    const restored = parseDataset(exportDataset([withMark()]))[0];
    expect(restored.marks).toHaveLength(1);
    expect(restored.marks![0]).toMatchObject({ effect: 'reversa', start: 12, end: 18, note: 'Cola invertida antes del cambio' });
  });

  it('una colección anterior a las marcas sigue siendo válida', () => {
    const legacy = JSON.parse(exportDataset([record()]));
    delete legacy.records[0].marks;
    expect(parseDataset(JSON.stringify(legacy))[0].marks).toBeUndefined();
  });

  it('rechaza una marca cuyo final no va después del inicio', () => {
    const bad = JSON.parse(exportDataset([withMark()]));
    bad.records[0].marks[0].end = bad.records[0].marks[0].start;
    expect(() => parseDataset(JSON.stringify(bad))).toThrow();
  });

  it('rechaza una herramienta inventada', () => {
    const bad = JSON.parse(exportDataset([withMark()]));
    bad.records[0].marks[0].effect = 'autotune';
    expect(() => parseDataset(JSON.stringify(bad))).toThrow();
  });
});
