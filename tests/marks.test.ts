import { describe, expect, it } from 'vitest';
import { MAX_MARKS, MIN_MARK_SECONDS, addMark, createMark, marksFor, removeMark, updateMark } from '../services/marks';
import { createReview, type ReviewRecord } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const DURATION = 20;
const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(48000 * DURATION)], 48000))!);
const record = (): ReviewRecord => createReview('f'.repeat(64), 'pieza.wav', features);

describe('Marcas sobre el audio', () => {
  it('recorta la marca a la duración del archivo', () => {
    const mark = createMark('reversa', -3, 999, DURATION);
    expect(mark.start).toBe(0);
    expect(mark.end).toBe(DURATION);
  });

  it('ordena inicio y final aunque se arrastre hacia atrás', () => {
    const mark = createMark('loops', 12, 4, DURATION);
    expect(mark.start).toBe(4);
    expect(mark.end).toBe(12);
  });

  it('impone la duración mínima', () => {
    const mark = createMark('filtros', 5, 5.001, DURATION);
    expect(mark.end - mark.start).toBeCloseTo(MIN_MARK_SECONDS, 3);
  });

  it('propone la etiqueta al crear la primera marca de una herramienta pendiente', () => {
    const base = record();
    const { patch, proposedLabel } = addMark(base, createMark('reversa', 12, 18, DURATION));
    expect(proposedLabel).toBe('reversa');
    expect(patch.labels?.reversa).toBe('present');
    expect(patch.marks).toHaveLength(1);
  });

  it('no toca una etiqueta ya decidida', () => {
    const base = { ...record(), labels: { ...record().labels, reversa: 'absent' as const } };
    const { patch, proposedLabel } = addMark(base, createMark('reversa', 12, 18, DURATION));
    expect(proposedLabel).toBeNull();
    expect(patch.labels).toBeUndefined();
  });

  it('no vuelve a proponer con la segunda marca', () => {
    const base = record();
    const first = addMark(base, createMark('reversa', 1, 3, DURATION));
    const withOne = { ...base, ...first.patch } as ReviewRecord;
    const second = addMark(withOne, createMark('reversa', 8, 9, DURATION));
    expect(second.proposedLabel).toBeNull();
  });

  it('borrar la última marca deja la etiqueta intacta', () => {
    const base = record();
    const added = addMark(base, createMark('reversa', 12, 18, DURATION));
    const withOne = { ...base, ...added.patch } as ReviewRecord;
    const removed = removeMark(withOne, withOne.marks![0].id);
    expect(removed.patch.marks).toEqual([]);
    expect(removed.patch.labels).toBeUndefined();
    expect(withOne.labels.reversa).toBe('present');
  });

  it('mantiene las marcas ordenadas por tiempo', () => {
    let current = record();
    for (const start of [9, 2, 5]) current = { ...current, ...addMark(current, createMark('loops', start, start + 1, DURATION)).patch } as ReviewRecord;
    expect(current.marks!.map(m => m.start)).toEqual([2, 5, 9]);
  });

  it('edita tiempos y comentario sin proponer etiqueta', () => {
    const base = record();
    const added = addMark(base, createMark('filtros', 3, 6, DURATION));
    const withOne = { ...base, ...added.patch } as ReviewRecord;
    const edited = updateMark(withOne, withOne.marks![0].id, { end: 999, note: 'Barrido de paso bajo' }, DURATION);
    expect(edited.patch.marks![0].end).toBe(DURATION);
    expect(edited.patch.marks![0].note).toBe('Barrido de paso bajo');
    expect(edited.proposedLabel).toBeNull();
  });

  it('editar una marca que no existe no cambia nada', () => {
    expect(updateMark(record(), 'inexistente', { note: 'x' }, DURATION).patch).toEqual({});
  });

  it('rechaza pasar del tope de marcas', () => {
    let current = record();
    for (let i = 0; i < MAX_MARKS; i++) current = { ...current, ...addMark(current, createMark('loops', i * 0.1, i * 0.1 + 0.05, DURATION)).patch } as ReviewRecord;
    expect(() => addMark(current, createMark('loops', 1, 2, DURATION))).toThrow(/200/);
  });

  it('permite solapamientos: un tramo puede llevar dos herramientas a la vez', () => {
    let current = record();
    current = { ...current, ...addMark(current, createMark('reversa', 5, 9, DURATION)).patch } as ReviewRecord;
    current = { ...current, ...addMark(current, createMark('filtros', 6, 8, DURATION)).patch } as ReviewRecord;
    current = { ...current, ...addMark(current, createMark('reversa', 7, 10, DURATION)).patch } as ReviewRecord;
    expect(current.marks).toHaveLength(3);
    expect(marksFor(current, 'reversa')).toHaveLength(2);
  });

  it('filtra las marcas de una herramienta', () => {
    let current = record();
    current = { ...current, ...addMark(current, createMark('loops', 1, 2, DURATION)).patch } as ReviewRecord;
    current = { ...current, ...addMark(current, createMark('reversa', 3, 4, DURATION)).patch } as ReviewRecord;
    expect(marksFor(current, 'loops')).toHaveLength(1);
    expect(marksFor(record(), 'loops')).toEqual([]);
  });
});
