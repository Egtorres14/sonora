import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadKey, saveKey, clearKeys, hasKey } from '../services/engines';
import { buildPrompt } from '../services/llm/prompt';
import type { EvaluationInput } from '../services/llm/types';
import { DEFAULT_RUBRIC } from '../services/scoring/rubric';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

/** localStorage mínimo para simular el navegador del profesor. */
const fakeStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear(), key: () => null, get length() { return m.size; } };
};

describe('Llaves de API del profesor', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', fakeStorage()); clearKeys(); });

  it('guarda y recupera la llave sin depender de ningún otro ajuste', () => {
    saveKey('gemini', '  AIza-prueba  ');
    expect(loadKey('gemini')).toBe('AIza-prueba');
    expect(hasKey('gemini')).toBe(true);
    expect(loadKey('openai')).toBe('');
    expect(hasKey('openai')).toBe(false);
  });

  it('sobrevive a una recarga (nueva lectura desde el almacén)', () => {
    saveKey('anthropic', 'sk-ant-1');
    expect(localStorage.getItem('sonora.key.anthropic')).toBe('sk-ant-1');
    expect(loadKey('anthropic')).toBe('sk-ant-1');
  });

  it('borra la llave al guardar una cadena vacía', () => {
    saveKey('openai', 'sk-1');
    saveKey('openai', '   ');
    expect(loadKey('openai')).toBe('');
    expect(localStorage.getItem('sonora.key.openai')).toBeNull();
  });

  it('migra las llaves guardadas por la versión anterior (ape.key.*)', () => {
    localStorage.setItem('ape.key.gemini', 'AIza-vieja');
    expect(loadKey('gemini')).toBe('AIza-vieja');
    expect(localStorage.getItem('sonora.key.gemini')).toBe('AIza-vieja');
    expect(localStorage.getItem('ape.key.gemini')).toBeNull();
  });

  it('clearKeys elimina todas las llaves', () => {
    saveKey('gemini', 'a'); saveKey('openai', 'b'); saveKey('anthropic', 'c');
    clearKeys();
    expect(hasKey('gemini') || hasKey('openai') || hasKey('anthropic')).toBe(false);
  });
  it('avisa de un fallo de almacenamiento y conserva la clave solo en la sesión', () => {
    const storage = fakeStorage();
    storage.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
    vi.stubGlobal('localStorage', storage);
    expect(saveKey('gemini', 'session-only')).toBe(false);
    expect(loadKey('gemini')).toBe('session-only');
  });
  it('al borrar no reaparece la clave de desarrollo', () => {
    vi.stubGlobal('__SONORA_DEV_KEYS__', { gemini: 'dev-fixture-key' });
    expect(loadKey('gemini')).toBe('dev-fixture-key');
    expect(saveKey('gemini', '')).toBe(true);
    expect(loadKey('gemini')).toBe('');
    vi.stubGlobal('__SONORA_DEV_KEYS__', {});
  });
});

const makeInput = (over: Partial<EvaluationInput> = {}): EvaluationInput => {
  const sr = 48000;
  const x = Float32Array.from({ length: sr * 3 }, (_, i) => Math.sin(i * 2 * Math.PI * 220 / sr) * 0.2);
  const features = extractFeatures(decodePcm(encodeWav16([x], sr))!);
  return { fileName: 'campana_procesada.wav', synopsis: '', context: '', features, rubric: DEFAULT_RUBRIC, ...over };
};

describe('Prompt especializado para los modelos', () => {
  it('por defecto se dirige al profesor, explica la rúbrica y el contrato de salida', () => {
    const { system, userText } = buildPrompt(makeInput(), { audio: true, image: true });
    expect(system).toMatch(/PROTOCOLO/);
    expect(system).toMatch(/pitch shift/i);
    expect(system).toMatch(/reversa/i);
    expect(system).toMatch(/time stretch/i);
    expect(system).toMatch(/filtros/i);
    expect(system).toMatch(/loops/i);
    expect(system).toMatch(/CALIBRACIÓN/);
    expect(system).toMatch(/CONTRATO DE SALIDA|FORMATO DE SALIDA/);
    expect(system).toMatch(/descripcion_sonora/);
    expect(system).toMatch(/comentarios_generales/);
    expect(system).toMatch(/limitaciones/);
    expect(system).toMatch(/profesor/i);
    expect(system).not.toMatch(/LECTURA ORIENTATIVA/);
    expect(userText).toContain('campana_procesada.wav');
    expect(userText).toMatch(/no se proporcionó sinopsis/);
  });

  it('en modo estudiante pide una lectura orientativa sin notas ni penalizaciones', () => {
    const { system } = buildPrompt(makeInput({ audience: 'student' }), { audio: true, image: false });
    expect(system).toMatch(/LECTURA ORIENTATIVA/);
    expect(system).toMatch(/no es una nota|no es tu nota|sin nota/i);
    expect(system).toMatch(/penaliza/i); // le explica que no debe hablar de penalizaciones
  });

  it('describe lo que el modelo percibe según la modalidad', () => {
    expect(buildPrompt(makeInput(), { audio: true, image: true }).system).toMatch(/Recibes el AUDIO/);
    expect(buildPrompt(makeInput(), { audio: true, image: true }).system).toMatch(/ESPECTROGRAMA/);
    expect(buildPrompt(makeInput(), { audio: true, image: false }).system).not.toMatch(/un ESPECTROGRAMA/);
    expect(buildPrompt(makeInput(), { audio: false, image: true }).system).toMatch(/NO recibes el audio/);
    expect(buildPrompt(makeInput(), { audio: false, image: false }).system).toMatch(/NO recibes el audio ni/);
  });

  it('refleja la rúbrica activa: herramientas exigidas, opcionales y niveles de sobreprocesamiento', () => {
    const rubric = { ...DEFAULT_RUBRIC, creative: { ...DEFAULT_RUBRIC.creative, requiredTools: ['reversa'] as const } } as typeof DEFAULT_RUBRIC;
    const { system } = buildPrompt(makeInput({ rubric, synopsis: 'Grabé una campana y la invertí en 0:05.', context: 'Trabajar la reversa.' }), { audio: true, image: true });
    expect(system).toMatch(/Exigidas por la rúbrica: reversa/);
    expect(system).toMatch(/Opcionales.*pitch shift/);
    expect(system).toMatch(/Leve/); expect(system).toMatch(/Moderado/); expect(system).toMatch(/Severo/);
    expect(system).toMatch(/generador de tonos|delay|reverb/i);
  });

  it('incluye sinopsis, contexto y métricas en el mensaje de usuario', () => {
    const { userText } = buildPrompt(makeInput({ synopsis: 'Invertí la campana.', context: 'Objetivo: reversa.' }), { audio: false, image: true });
    expect(userText).toContain('Invertí la campana.');
    expect(userText).toContain('Objetivo: reversa.');
    expect(userText).toMatch(/48000 Hz/);
    expect(userText).toMatch(/LUFS/);
  });
});
