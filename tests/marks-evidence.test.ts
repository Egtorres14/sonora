import { describe, expect, it } from 'vitest';
import { buildEvidence } from '../services/evidence';
import { addMark, createMark } from '../services/marks';
import { createReview, type ReviewRecord } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const DURATION = 20;
const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(48000 * DURATION)], 48000))!);
const base = (): ReviewRecord => createReview('b'.repeat(64), 'pieza.wav', features);

describe('Evidencias a partir de marcas', () => {
  it('usa las marcas en lugar del texto cuando las hay', () => {
    let record = { ...base(), evidence: { ...base().evidence, reversa: '0:02–0:03 escrito a mano' } } as ReviewRecord;
    const mark = { ...createMark('reversa', 12, 18, DURATION), note: 'Cola invertida' };
    record = { ...record, ...addMark(record, mark).patch } as ReviewRecord;
    const items = buildEvidence(record).filter(i => i.effect === 'reversa' && i.source === 'profesor');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: `mark-${mark.id}`, time: 12, end: 18, detalle: 'Cola invertida' });
  });

  it('sin marcas sigue parseando los tiempos del texto', () => {
    const record = { ...base(), labels: { ...base().labels, reversa: 'present' as const }, evidence: { ...base().evidence, reversa: '0:12–0:18 cola invertida' } };
    const items = buildEvidence(record).filter(i => i.effect === 'reversa' && i.source === 'profesor');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'teacher-reversa-0', time: 12, end: 18 });
  });

  it('la primera marca lleva los puntos y las siguientes no', () => {
    let record = base();
    record = { ...record, ...addMark(record, createMark('reversa', 2, 4, DURATION)).patch } as ReviewRecord;
    record = { ...record, ...addMark(record, createMark('reversa', 9, 11, DURATION)).patch } as ReviewRecord;
    const items = buildEvidence(record).filter(i => i.effect === 'reversa' && i.source === 'profesor');
    expect(items).toHaveLength(2);
    expect(items[1].puntos).toBeNull();
    expect(items[0].puntos).not.toBeNull();
  });

  it('una marca sin comentario cae en el detalle por defecto', () => {
    let record = base();
    record = { ...record, ...addMark(record, createMark('loops', 5, 7, DURATION)).patch } as ReviewRecord;
    const item = buildEvidence(record).find(i => i.effect === 'loops' && i.source === 'profesor');
    expect(item?.detalle).toBe('Uso confirmado');
  });

  it('el estudiante no ve las marcas hasta que se publica la revisión', () => {
    let record = base();
    record = { ...record, ...addMark(record, createMark('reversa', 12, 18, DURATION)).patch } as ReviewRecord;
    expect(buildEvidence(record, undefined, 'student').some(i => i.source === 'profesor')).toBe(false);
    expect(buildEvidence({ ...record, published: true }, undefined, 'student').some(i => i.id.startsWith('mark-'))).toBe(true);
  });
});
