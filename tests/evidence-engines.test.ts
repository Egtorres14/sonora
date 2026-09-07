import { describe, it, expect, beforeEach } from 'vitest';
import { parseTimeRanges, buildEvidence } from '../services/evidence';
import { loadEngineSettings, saveEngineSettings, resetEngineSettings, engineCost, DEFAULT_ENGINES } from '../services/engines';
import { createReview } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

describe('Evidencias con tiempos', () => {
  it('extrae instantes y rangos de texto libre', () => {
    expect(parseTimeRanges('0:12–0:18 comparación con la fuente')).toEqual([{ start: 12, end: 18 }]);
    expect(parseTimeRanges('cola invertida en 0:45 y 1:02.5')).toEqual([{ start: 45 }, { start: 62.5 }]);
    expect(parseTimeRanges('de 0:10 a 0:20 y luego 0:30-0:35')).toEqual([{ start: 10, end: 20 }, { start: 30, end: 35 }]);
    expect(parseTimeRanges('sin tiempos')).toEqual([]);
  });
  it('reúne medidas, anotaciones del profesor y sugerencias del modelo ordenadas por tiempo', () => {
    const sr = 48000;
    const x = Float32Array.from({ length: sr * 20 }, (_, i) => Math.sin(i * 2 * Math.PI * 200 / sr) * 0.1);
    x[10 * sr] += 0.3;
    const record = createReview('b'.repeat(64), 'campana.wav', extractFeatures(decodePcm(encodeWav16([x], sr))!));
    record.labels.reversa = 'present'; record.evidence.reversa = '0:12–0:18 cola invertida';
    record.labels.filtros = 'absent';
    const items = buildEvidence(record);
    const click = items.find((i) => i.criterio === 'Clic de edición');
    expect(click?.time).toBeCloseTo(10, 1);
    expect(click?.source).toBe('medido');
    expect(click?.puntos).toBe(-1);
    const rev = items.find((i) => i.effect === 'reversa' && i.source === 'profesor');
    expect(rev).toMatchObject({ time: 12, end: 18, puntos: 0 });
    const filt = items.find((i) => i.effect === 'filtros');
    expect(filt).toMatchObject({ source: 'profesor', puntos: -2.5 });
    expect(filt?.time).toBeUndefined();
    const timed = items.filter((i) => i.time !== undefined).map((i) => i.time!);
    expect([...timed].sort((a, b) => a - b)).toEqual(timed);
  });
});

describe('Motores de IA', () => {
  beforeEach(() => resetEngineSettings());
  it('por defecto usa el modelo local sin coste', () => {
    expect(loadEngineSettings()).toEqual(DEFAULT_ENGINES);
    expect(engineCost(DEFAULT_ENGINES, 60)).toBe(0);
  });
  it('guarda la elección, sanea modelos inválidos y estima coste', () => {
    saveEngineSettings({ ...DEFAULT_ENGINES, engine: 'gemini', runs: 3, studentAccess: true, models: { ...DEFAULT_ENGINES.models, gemini: 'modelo-inexistente' } });
    const s = loadEngineSettings();
    expect(s.engine).toBe('gemini'); expect(s.runs).toBe(3); expect(s.studentAccess).toBe(true);
    expect(s.models.gemini).toBe(DEFAULT_ENGINES.models.gemini);
    expect(engineCost(s, 60)).toBeGreaterThan(0.01);
    expect(engineCost(s, 60, 1)).toBeLessThan(engineCost(s, 60));
  });
});
