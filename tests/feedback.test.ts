import { describe, expect, it } from 'vitest';
import { createReview } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';
import { draftFeedback } from '../services/feedback';
import { DEFAULT_RUBRIC } from '../services/scoring/rubric';

const samples = Float32Array.from({ length: 48000 }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / 48000) * 0.1);
const measured = extractFeatures(decodePcm(encodeWav16([samples], 48000))!);
const features = { ...measured, format: { ...measured.format, duration: 60 } };

describe('Borrador de feedback local', () => {
  it('sin revisión deja la nota abierta y no inventa herramientas', () => {
    const r = createReview('a'.repeat(64), 'campana_bosque.wav', features);
    const d = draftFeedback(r);
    expect(d.text).toMatch(/^Hola\./);
    expect(d.pending).toEqual(expect.arrayContaining(['Pitch shift', 'sobreprocesamiento', 'efectos extra']));
    expect(d.text).toContain('Quedan por revisar');
    expect(d.text).not.toContain('Nota:');
    expect(d.strengths.some((s) => s.includes('cortes están limpios'))).toBe(true);
    expect(d.improvements.some((s) => s.includes('sinopsis'))).toBe(true);
  });
  it('con la revisión completa cita nota, evidencias del profesor y nombre del estudiante', () => {
    const r = { ...createReview('b'.repeat(64), 'perez_maria_p1.wav', features), synopsis: 'Paisaje sonoro.', student: { name: 'María Pérez', submittedAt: new Date().toISOString() }, labels: { pitch_shift: 'present', time_stretch: 'absent', reversa: 'present', filtros: 'present', loops: 'absent' }, evidence: { pitch_shift: '0:12–0:18 sube una octava', time_stretch: '', reversa: '', filtros: '', loops: '' }, overprocessing: 'Leve', extra: 'present' } as const;
    const d = draftFeedback(r, DEFAULT_RUBRIC);
    expect(d.text).toMatch(/^Hola, María\./);
    expect(d.text).toContain('0:12–0:18 sube una octava');
    expect(d.text).toContain('No se aprecia time stretch');
    expect(d.text).toContain('Sobreprocesamiento leve');
    expect(d.text).toMatch(/Nota: [\d,]+ \/ 30/);
    expect(d.pending).toEqual([]);
    // Loops es opcional en la rúbrica por defecto: su ausencia no se reprocha.
    expect(d.improvements.some((s) => s.includes('loops'))).toBe(false);
  });
  it('es determinista', () => {
    const r = createReview('c'.repeat(64), 'x.wav', features);
    expect(draftFeedback(r).text).toBe(draftFeedback(r).text);
  });
});
