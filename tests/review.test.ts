import { describe, expect, it } from 'vitest';
import { createReview, calculateReview, updateReview } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const samples = Float32Array.from({ length: 48000 }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / 48000) * 0.1);
const measured = extractFeatures(decodePcm(encodeWav16([samples], 48000))!);
const features = { ...measured, format: { ...measured.format, duration: 60 } };
const review = () => createReview('a'.repeat(64), 'campana_bosque.wav', features);

describe('Revisión local independiente de IA', () => {
  it('no entrega nota final ni penaliza como ausentes las herramientas pendientes', () => {
    const score = calculateReview(review());
    expect(score.final).toBeNull();
    expect(score.pending).toContain('pitch_shift');
    expect(score.maximum).toBeGreaterThan(score.minimum);
  });
  it('las etiquetas humanas recalculan la creatividad y el total', () => {
    let r = review();
    r = { ...r, synopsis: 'Paisaje sonoro a partir de una campana.', labels: { pitch_shift: 'present', time_stretch: 'present', reversa: 'present', filtros: 'present', loops: 'unknown' }, overprocessing: 'none', extra: 'absent' };
    expect(calculateReview(r).final).toBe(30);
    r = updateReview(r, { labels: { ...r.labels, pitch_shift: 'absent' } });
    expect(calculateReview(r).final).toBe(27.5);
    expect(calculateReview(r).creative.lines.find(l => l.criterio.includes('Pitch'))?.puntos).toBe(-2.5);
  });
  it('conserva una nota manual al editar comentarios y limita el rango', () => {
    const r = updateReview(review(), { manualScore: 23.5 });
    expect(calculateReview(updateReview(r, { notes: 'Corrección del profesor' })).final).toBe(23.5);
    expect(() => updateReview(r, { manualScore: -1 })).toThrow();
    expect(() => updateReview(r, { manualScore: 100 })).toThrow();
    expect(calculateReview(updateReview(r, { manualScore: null })).final).toBeNull();
  });
});
