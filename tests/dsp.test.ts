import { describe, it, expect } from 'vitest';
import { measureLoudness, measureTruePeak, detectClipping, detectClicks, analyzeStereo, analyzeSilence, analyzeSpectrum, detectReverseEnvelopes, measureDcOffset } from '../services/audio/dsp';
import { decodePcm, encodeWav16, parseAudioHeader } from '../services/audio/wav';
import { extractFeatures } from '../services/audio/features';
import { scoreTechnical, scoreFormal, scoreCreative, DEFAULT_RUBRIC, isGenericFileName } from '../services/scoring/rubric';

const SR = 48000;
const sine = (f: number, peakDb: number, secs: number, sr = SR, phase = 0) => {
  const n = Math.floor(secs * sr), a = Math.pow(10, peakDb / 20);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a * Math.sin(2 * Math.PI * f * i / sr + phase);
  return out;
};
// PRNG determinista
const rng = (seed = 1) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const noise = (rmsDb: number, secs: number, sr = SR, seed = 1) => {
  const r = rng(seed); const n = Math.floor(secs * sr); const a = Math.pow(10, rmsDb / 20) * Math.sqrt(3);
  const out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = (r() * 2 - 1) * a; return out;
};

describe('Sonoridad BS.1770 / EBU R128', () => {
  it('EBU Tech 3341 caso 1: seno 1 kHz −23 dBFS estéreo → −23.0 LUFS ±0.1', () => {
    const r = measureLoudness([sine(1000, -23, 20), sine(1000, -23, 20)], SR);
    expect(r.integrated).toBeCloseTo(-23.0, 1);
  });
  it('EBU Tech 3341 caso 2: seno 1 kHz −33 dBFS estéreo → −33.0 LUFS ±0.1', () => {
    const r = measureLoudness([sine(1000, -33, 20), sine(1000, -33, 20)], SR);
    expect(r.integrated).toBeCloseTo(-33.0, 1);
  });
  it('funciona a 44.1 kHz y 96 kHz (coeficientes K recalculados)', () => {
    expect(measureLoudness([sine(1000, -23, 10, 44100), sine(1000, -23, 10, 44100)], 44100).integrated).toBeCloseTo(-23.0, 1);
    expect(measureLoudness([sine(1000, -23, 10, 96000), sine(1000, -23, 10, 96000)], 96000).integrated).toBeCloseTo(-23.0, 1);
  });
  it('la puerta relativa ignora los pasajes silenciosos (EBU 3341 caso 5 simplificado)', () => {
    const loud = sine(1000, -23, 20), quiet = sine(1000, -60, 20);
    const ch = new Float32Array(loud.length + quiet.length); ch.set(loud); ch.set(quiet, loud.length);
    expect(measureLoudness([ch, ch], SR).integrated).toBeCloseTo(-23.0, 0);
  });
  it('silencio digital → −Infinity, no NaN', () => {
    expect(measureLoudness([new Float32Array(SR)], SR).integrated).toBe(-Infinity);
  });
});

describe('True peak', () => {
  it('detecta picos inter-muestra: seno a fs/4 con fase π/4 (muestras ±0.707, pico real 1.0)', () => {
    const x = sine(SR / 4, 0, 1, SR, Math.PI / 4);
    const r = measureTruePeak([x], SR);
    expect(r.samplePeakDbfs).toBeCloseTo(-3.01, 1);
    expect(r.dbtp).toBeGreaterThan(-0.3);
  });
  it('un seno de 1 kHz a −6 dBFS da ≈ −6 dBTP', () => {
    expect(measureTruePeak([sine(1000, -6, 2)], SR).dbtp).toBeCloseTo(-6, 1);
  });
});

describe('Clipping', () => {
  it('500 muestras consecutivas a +fondo de escala (16 bit) se detectan', () => {
    const x = sine(440, -6, 2); for (let i = 10000; i < 10500; i++) x[i] = 32767 / 32768;
    const r = detectClipping([x], SR, { bitDepth: 16, sampleFormat: 'int' });
    expect(r.detected).toBe(true); expect(r.runCount).toBe(1); expect(r.clippedSamples).toBe(500);
  });
  it('un único pico aislado a fondo de escala NO es clipping', () => {
    const x = sine(440, -6, 2); x[10000] = 32767 / 32768;
    expect(detectClipping([x], SR, { bitDepth: 16, sampleFormat: 'int' }).detected).toBe(false);
  });
  it('un seno a −1 dBFS no satura', () => {
    expect(detectClipping([sine(440, -1, 2)], SR, { bitDepth: 24, sampleFormat: 'int' }).detected).toBe(false);
  });
  it('archivo float con muestras > 1.0 se marca (floatOvers)', () => {
    const x = sine(440, 0, 1); for (let i = 0; i < x.length; i++) x[i] *= 1.2;
    const r = detectClipping([x], SR, { bitDepth: 32, sampleFormat: 'float' });
    expect(r.floatOvers).toBeGreaterThan(0); expect(r.detected).toBe(true);
  });
});

describe('Detección de clics (residuo LPC)', () => {
  it('clic real de 1 muestra (+0.3) en un tono de 200 Hz a −20 dBFS → 1 clic en ~1.0 s', () => {
    const x = sine(200, -20, 4); x[SR] += 0.3;
    const ev = detectClicks([x], SR);
    expect(ev.length).toBe(1);
    expect(ev[0].time).toBeCloseTo(1.0, 3);
    expect(ev[0].kind).toBe('click');
  });
  it('clic pequeño (+0.05) en una señal suave también se detecta', () => {
    const x = sine(150, -30, 4); x[2 * SR] += 0.05;
    expect(detectClicks([x], SR).length).toBe(1);
  });
  it('tono limpio de 8 kHz a −3 dBFS → 0 clics (el detector antiguo daba 1200)', () => {
    expect(detectClicks([sine(8000, -3, 10), sine(8000, -3, 10)], SR).length).toBe(0);
  });
  it('ruido blanco a −12 dBFS (viento/lluvia) → ≤ 1 clic (el antiguo daba 1199)', () => {
    expect(detectClicks([noise(-12, 10)], SR).length).toBeLessThanOrEqual(1);
  });
  it('un golpe percusivo (ráfaga con decaimiento) NO es un clic', () => {
    const x = sine(110, -24, 4); const r = rng(7);
    for (let i = 0; i < 0.12 * SR; i++) x[SR + i] += (r() * 2 - 1) * 0.5 * Math.exp(-i / (0.03 * SR));
    expect(detectClicks([x], SR).filter((e) => e.kind === 'click').length).toBe(0);
  });
  it('corte duro sin crossfade entre dos sonidos distintos → discontinuidad', () => {
    // tono suave a −12 dBFS que corta en seco (fuera del cruce por cero) a otro tono 9 dB más fuerte
    const a = sine(220, -12, 2, SR, Math.PI / 2), b = sine(330, -3, 2, SR, -Math.PI / 2);
    const x = new Float32Array(a.length + b.length); x.set(a); x.set(b, a.length);
    const ev = detectClicks([x], SR);
    const hit = ev.find((e) => Math.abs(e.time - 2.0) < 0.002);
    expect(hit).toBeDefined();
    expect(hit!.kind).toBe('discontinuity');
  });
  it('un ataque natural (rampa de 5 ms) NO es una discontinuidad', () => {
    const x = new Float32Array(4 * SR); const b = sine(330, -3, 2);
    for (let i = 0; i < b.length; i++) x[2 * SR + i] = b[i] * Math.min(1, i / (0.005 * SR));
    expect(detectClicks([x], SR).length).toBe(0);
  });
  it('clics en canales distintos se cuentan ambos (bug antiguo: el 2.º canal se perdía)', () => {
    const L = sine(200, -20, 60), R = sine(200, -20, 60);
    L[50 * SR] += 0.5; R[2 * SR] += 0.5;
    const ev = detectClicks([L, R], SR);
    expect(ev.length).toBe(2);
    expect(ev.map((e) => Math.round(e.time))).toEqual([2, 50]);
  });
  it('los timestamps respetan el sample rate nativo (96 kHz)', () => {
    const x = sine(200, -20, 4, 96000); x[3 * 96000] += 0.3;
    expect(detectClicks([x], 96000)[0].time).toBeCloseTo(3.0, 3);
  });
});

describe('Estéreo, silencio, DC, espectro', () => {
  it('dual mono → correlación 1, isDualMono', () => {
    const x = sine(440, -6, 1); const r = analyzeStereo(x, x);
    expect(r.correlation).toBe(1); expect(r.isDualMono).toBe(true);
  });
  it('canales en oposición de fase → correlación −1', () => {
    const x = sine(440, -6, 1); const y = x.map((v) => -v);
    expect(analyzeStereo(x, y).correlation).toBeCloseTo(-1, 2);
  });
  it('silencio inicial/final y huecos internos', () => {
    const x = new Float32Array(5 * SR); x.set(sine(440, -6, 1), SR); x.set(sine(440, -6, 1), 3 * SR);
    const r = analyzeSilence([x], SR);
    expect(r.leadingSec).toBeCloseTo(1, 1); expect(r.trailingSec).toBeCloseTo(1, 1);
    expect(r.gaps.length).toBe(1); expect(r.gaps[0].start).toBeCloseTo(2, 1);
  });
  it('DC offset', () => {
    const x = sine(440, -6, 1).map((v) => v + 0.05);
    expect(measureDcOffset([x])[0]).toBeCloseTo(0.05, 3);
  });
  it('un tono de 1 kHz tiene centroide ≈ 1 kHz y sin energía > 16 kHz', () => {
    const s = analyzeSpectrum(sine(1000, -6, 5), SR);
    expect(s.centroidHz).toBeGreaterThan(900); expect(s.centroidHz).toBeLessThan(1100);
    expect(s.energyAbove16kDb).toBeLessThan(-60);
  });
  it('ruido blanco tiene energía por encima de 16 kHz y flatness alta', () => {
    const s = analyzeSpectrum(noise(-12, 5), SR);
    expect(s.energyAbove16kDb).toBeGreaterThan(-10); expect(s.flatness).toBeGreaterThan(0.5);
  });
  it('heurístico reversa: crescendo de 1 s y corte abrupto → 1 evento', () => {
    const x = new Float32Array(4 * SR); const r = rng(9);
    for (let i = 0; i < SR; i++) x[SR + i] = (r() * 2 - 1) * 0.5 * Math.exp((i - SR) / (0.25 * SR));
    expect(detectReverseEnvelopes(x, SR).count).toBe(1);
  });
});

describe('WAV encode/decode', () => {
  it('roundtrip 16 bit estéreo 48 kHz conserva rate, bits y muestras', () => {
    const L = sine(440, -6, 0.5), R = sine(880, -12, 0.5);
    const buf = encodeWav16([L, R], SR);
    const h = parseAudioHeader(buf)!;
    expect(h.sampleRate).toBe(SR); expect(h.bitDepth).toBe(16); expect(h.numChannels).toBe(2);
    const d = decodePcm(buf)!;
    expect(d.sampleRate).toBe(SR); expect(d.bitDepth).toBe(16); expect(d.channels.length).toBe(2);
    expect(d.channels[0][100]).toBeCloseTo(L[100], 3);
    expect(d.channels[1][100]).toBeCloseTo(R[100], 3);
  });
  it('rechaza buffers que no son WAV/AIFF', () => {
    expect(parseAudioHeader(new ArrayBuffer(64))).toBeNull();
  });
});

describe('Rúbrica determinista', () => {
  it('nombres genéricos', () => {
    expect(isGenericFileName('audio.wav', DEFAULT_RUBRIC.formal.genericNamePatterns)).toBe(true);
    expect(isGenericFileName('Proyecto 1.wav', DEFAULT_RUBRIC.formal.genericNamePatterns)).toBe(true);
    expect(isGenericFileName('bosque_nocturno_campana.wav', DEFAULT_RUBRIC.formal.genericNamePatterns)).toBe(false);
  });
  it('formal: sinopsis + nombre → 5 puntos', () => {
    expect(scoreFormal('bosque_nocturno.wav', 'Un paisaje sonoro construido a partir de una campana.').total).toBe(5);
    expect(scoreFormal('audio.wav', '').total).toBe(0);
  });
  it('técnica: archivo perfecto 48 kHz, 60 s, sin clipping ni clics → 12.5', () => {
    const buf = encodeWav16([sine(440, -6, 60), sine(660, -6, 60)], SR);
    const f = extractFeatures(decodePcm(buf)!, { fileName: 'x.wav' });
    expect(scoreTechnical(f).total).toBe(12.5);
  });
  it('técnica: 44.1 kHz + clipping + 3 clics + 40 s → 12.5 − 2.5 − 2.5 − 2.5 − 1 = 4', () => {
    const x = sine(440, -6, 40, 44100);
    // clipping real: 200 ms amplificados ×4 y recortados a fondo de escala (continuo en los bordes)
    for (let i = 4410; i < 4410 + 8820; i++) x[i] = Math.max(-1, Math.min(32767 / 32768, x[i] * 4));
    x[44100 * 10] += 0.3; x[44100 * 20] += 0.3; x[44100 * 30] += 0.3;
    const f = extractFeatures(decodePcm(encodeWav16([x], 44100))!, { fileName: 'x.wav' });
    const s = scoreTechnical(f);
    expect(s.clicksCounted).toBe(3);
    expect(s.total).toBe(4);
  });
  it('creatividad: 2 herramientas con confianza baja cuentan como no usadas', () => {
    const s = scoreCreative({
      herramientas: [
        { herramienta: 'pitch_shift', detectado: true, confianza: 0.9, calidad_de_uso: 'Buena' },
        { herramienta: 'time_stretch', detectado: true, confianza: 0.3, calidad_de_uso: 'Regular' },
        { herramienta: 'reversa', detectado: false, confianza: 0.8, calidad_de_uso: 'N/A' },
        { herramienta: 'filtros', detectado: true, confianza: 0.7, calidad_de_uso: 'Buena' },
      ],
      sobreprocesamiento: { detectado: true, nivel: 'Leve', confianza: 0.8 },
      efectosExtra: { detectado: true, confianza: 0.9 },
    });
    expect(s.total).toBe(12.5 - 2.5 - 2.5 - 1);
    expect(s.bonus).toBe(0.5);
  });
});

import { analyzeTemporal } from '../services/audio/dsp';

describe('Descriptores temporales', () => {
  const decayBurst = (secs: number, hits: number, reversed = false) => {
    const x = new Float32Array(secs * SR); const r = rng(11);
    for (let h = 0; h < hits; h++) {
      const at = Math.round((h + 0.5) * (secs / hits) * SR);
      for (let i = 0; i < 0.6 * SR && at + i < x.length; i++) {
        const env = reversed ? Math.exp((i - 0.6 * SR) / (0.15 * SR)) : Math.exp(-i / (0.15 * SR));
        x[at + i] += (r() * 2 - 1) * 0.6 * env;
      }
    }
    return x;
  };
  it('golpes naturales → asimetría positiva; golpes invertidos → negativa', () => {
    const nat = analyzeTemporal(decayBurst(6, 6), SR), rev = analyzeTemporal(decayBurst(6, 6, true), SR);
    expect(nat.envelopeAsymmetry).toBeGreaterThan(0.3);
    expect(rev.envelopeAsymmetry).toBeLessThan(-0.3);
    expect(rev.reverseLikeFraction).toBeGreaterThan(0.5);
    expect(nat.onsetRate).toBeGreaterThan(0.5);
  });
  it('un loop digital de 1 s produce repeatFraction alta y lag ≈ 1 s; ruido estacionario no', () => {
    const r = rng(5); const seg = new Float32Array(SR); for (let i = 0; i < SR; i++) seg[i] = (r() * 2 - 1) * 0.5 * (0.3 + 0.7 * Math.abs(Math.sin(2 * Math.PI * 3 * i / SR)));
    const loop = new Float32Array(6 * SR); for (let k = 0; k < 6; k++) loop.set(seg, k * SR);
    const t = analyzeTemporal(loop, SR);
    expect(t.repeatFraction).toBeGreaterThan(0.6);
    expect(t.repeatLagSec).toBeCloseTo(1.0, 1);
    const stationary = analyzeTemporal(noise(-12, 6, SR, 21), SR);
    expect(stationary.repeatFraction).toBeLessThan(0.2);
  });
});
