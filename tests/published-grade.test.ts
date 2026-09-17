import { describe, expect, it } from 'vitest';
import { calculateReview, createReview, gradeDrift, publishGrade, snapshotGrade, updateReview, withdrawGrade, type ReviewRecord } from '../services/review';
import { DEFAULT_RUBRIC, type RubricConfig } from '../services/scoring/rubric';
import { exportCsv, exportDataset, parseDataset } from '../services/library';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(48000)], 48000))!);
/** Revisión completa: todas las herramientas decididas, sin pendientes. */
const reviewed = (): ReviewRecord => {
  const r = createReview('d'.repeat(64), 'entrega.wav', features);
  return { ...r, student: { name: 'Ana Pérez', submittedAt: new Date().toISOString() }, synopsis: 'x'.repeat(40), labels: { pitch_shift: 'present', time_stretch: 'present', reversa: 'present', filtros: 'present', loops: 'present' }, overprocessing: 'none', extra: 'absent' };
};
const stricter = (): RubricConfig => ({ ...DEFAULT_RUBRIC, formal: { ...DEFAULT_RUBRIC.formal, synopsisPoints: 0 }, totalPoints: DEFAULT_RUBRIC.totalPoints - DEFAULT_RUBRIC.formal.synopsisPoints });

describe('Nota congelada al publicar', () => {
  it('la instantánea refleja el cálculo del momento', () => {
    const record = reviewed();
    const live = calculateReview(record);
    const snap = snapshotGrade(record);
    expect(snap.final).toBe(live.final);
    expect(snap.formal).toBe(live.formal.total);
    expect(snap.technical).toBe(live.technical.total);
    expect(snap.creative).toBe(live.creative.total);
    expect(snap.bonus).toBe(live.bonus);
    expect(snap.maxTotal).toBe(live.maxTotal);
    expect(snap.manual).toBe(false);
    expect(Date.parse(snap.publishedAt)).not.toBeNaN();
  });

  it('no se puede congelar una revisión incompleta', () => {
    const record = { ...reviewed(), labels: { ...reviewed().labels, reversa: 'unknown' as const } };
    expect(() => snapshotGrade(record)).toThrow(/pendiente/i);
  });

  it('publicar fija la nota y retirar la borra, en un solo parche cada uno', () => {
    const record = reviewed();
    const published = { ...record, ...publishGrade(record) } as ReviewRecord;
    expect(published.published).toBe(true);
    expect(published.publishedGrade?.final).toBe(calculateReview(record).final);
    const withdrawn = { ...published, ...withdrawGrade() } as ReviewRecord;
    expect(withdrawn.published).toBe(false);
    expect(withdrawn.publishedGrade).toBeUndefined();
  });

  it('una nota manual se publica como manual', () => {
    const record = { ...reviewed(), manualScore: 21 };
    const snap = snapshotGrade(record);
    expect(snap.final).toBe(21);
    expect(snap.manual).toBe(true);
  });

  it('sin cambios no hay deriva', () => {
    const published = { ...reviewed(), ...publishGrade(reviewed()) } as ReviewRecord;
    expect(gradeDrift(published)).toBeNull();
  });

  it('editar la rúbrica después de publicar produce deriva', () => {
    const published = { ...reviewed(), ...publishGrade(reviewed()) } as ReviewRecord;
    const drift = gradeDrift(published, stricter());
    expect(drift).not.toBeNull();
    expect(drift!.published).toBe(published.publishedGrade!.final);
    expect(drift!.live).toBe(calculateReview(published, stricter()).final);
    expect(drift!.live).not.toBe(drift!.published);
  });

  it('retocar una etiqueta después de publicar produce deriva', () => {
    const published = { ...reviewed(), ...publishGrade(reviewed()) } as ReviewRecord;
    const relabelled = updateReview(published, { labels: { ...published.labels, reversa: 'absent' } });
    expect(gradeDrift(relabelled)?.live).toBeLessThan(published.publishedGrade!.final);
  });

  it('reanalizar el audio después de publicar produce deriva si cambia la parte técnica', () => {
    const published = { ...reviewed(), ...publishGrade(reviewed()) } as ReviewRecord;
    const remeasured = updateReview(published, { features: { ...published.features, clipping: { ...published.features.clipping, detected: true, runCount: 3, clippedSamples: 300 } } });
    expect(gradeDrift(remeasured)).not.toBeNull();
  });

  it('un registro publicado sin instantánea (anterior a este campo) no tiene deriva y sigue vivo', () => {
    const legacy = { ...reviewed(), published: true } as ReviewRecord;
    expect(legacy.publishedGrade).toBeUndefined();
    expect(gradeDrift(legacy)).toBeNull();
  });

  it('una revisión que vuelve a quedar pendiente tras publicar se señala como deriva', () => {
    const published = { ...reviewed(), ...publishGrade(reviewed()) } as ReviewRecord;
    const reopened = updateReview(published, { labels: { ...published.labels, reversa: 'unknown' } });
    const drift = gradeDrift(reopened);
    expect(drift).not.toBeNull();
    expect(drift!.live).toBeNull();
  });
});

describe('La instantánea viaja y se exporta', () => {
  it('sobrevive a exportar e importar la colección', () => {
    const published = { ...reviewed(), ...publishGrade(reviewed()) } as ReviewRecord;
    const restored = parseDataset(exportDataset([published]))[0];
    expect(restored.publishedGrade).toEqual(published.publishedGrade);
  });

  it('una colección anterior sin el campo sigue siendo válida', () => {
    const legacy = JSON.parse(exportDataset([{ ...reviewed(), published: true } as ReviewRecord]));
    delete legacy.records[0].publishedGrade;
    expect(parseDataset(JSON.stringify(legacy))[0].publishedGrade).toBeUndefined();
  });

  it('el CSV lleva la nota publicada junto a la viva', () => {
    const published = { ...reviewed(), ...publishGrade(reviewed()) } as ReviewRecord;
    const csv = exportCsv([published], stricter());
    const [header, row] = csv.split('\r\n');
    const columns = header.split(';');
    const values = row.split(';');
    const live = calculateReview(published, stricter()).final;
    expect(columns).toContain('"Nota publicada"');
    expect(values[columns.indexOf('"Nota publicada"')]).toBe(`"${published.publishedGrade!.final}"`);
    expect(values[columns.indexOf('"Nota final"')]).toBe(`"${live}"`);
    expect(live).not.toBe(published.publishedGrade!.final);
  });
});
