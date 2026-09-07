import { describe, it, expect } from 'vitest';
import { fftInPlace } from '../services/audio/dsp';
import { timeStretch, pitchShift, reverseWhole, reverseSegments, filterSweep, lowpass, insertLoop, reverb, delay, mulberry32, synthSource } from '../scripts/corpus/dsp-effects';

const SR = 48000;
const sine = (f: number, secs: number, amp = 0.5) => { const n = Math.round(secs * SR); const y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = amp * Math.sin(2 * Math.PI * f * i / SR); return y; };
const peakHz = (x: Float32Array, from = 0) => {
  const N = 8192; const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[from + i] ?? 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  fftInPlace(re, im);
  let best = 1, bm = 0; for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); if (m > bm) { bm = m; best = k; } }
  return best * SR / N;
};
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe('Efectos del corpus', () => {
  it('time stretch ×1.5 alarga la duración y conserva la altura', () => {
    const x = sine(440, 2); const y = timeStretch(x, 1.5);
    expect(y.length).toBe(Math.round(x.length * 1.5));
    expect(peakHz(y, SR)).toBeCloseTo(440, -1);
    expect(rms(y.subarray(SR, 2 * SR))).toBeGreaterThan(0.2);
  });
  it('time stretch ×0.5 acorta', () => {
    const x = sine(440, 2); expect(timeStretch(x, 0.5).length).toBe(x.length / 2);
  });
  it('pitch shift +12 duplica la frecuencia y mantiene la duración', () => {
    const x = sine(220, 2); const y = pitchShift(x, SR, 12);
    expect(y.length).toBe(x.length);
    expect(peakHz(y, SR / 2)).toBeCloseTo(440, -1);
  });
  it('pitch shift −5 baja a 2^(−5/12)', () => {
    const y = pitchShift(sine(440, 2), SR, -5);
    expect(peakHz(y, SR / 2)).toBeCloseTo(440 * Math.pow(2, -5 / 12), -1);
  });
  it('reversa completa y por segmentos', () => {
    const x = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from(reverseWhole(x))).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    const y = reverseSegments(Float32Array.from({ length: 4800 }, (_, i) => i), [{ start: 1000, end: 2000 }]);
    expect(y[999]).toBe(999); expect(y[2000]).toBe(2000);
    expect(y[1500]).toBeCloseTo(1499, 0); // centro del segmento invertido
  });
  it('paso bajo a 500 Hz atenúa un tono de 5 kHz más de 30 dB y deja pasar 100 Hz', () => {
    const hi = lowpass(sine(5000, 1), SR, 500), lo = lowpass(sine(100, 1), SR, 500);
    expect(20 * Math.log10(rms(hi.subarray(SR / 2)) / rms(sine(5000, 1)))).toBeLessThan(-30);
    expect(20 * Math.log10(rms(lo.subarray(SR / 2)) / rms(sine(100, 1)))).toBeGreaterThan(-1);
  });
  it('barrido: el tono de 2 kHz pasa al principio (fc 8 kHz) y se atenúa al final (fc 200 Hz)', () => {
    const y = filterSweep(sine(2000, 2), SR, 'lowpass', 8000, 200, 0.7);
    expect(rms(y.subarray(0, SR / 4))).toBeGreaterThan(0.3);
    expect(rms(y.subarray(1.75 * SR))).toBeLessThan(0.05);
  });
  it('loop inserta repeticiones y conserva la longitud', () => {
    const x = Float32Array.from({ length: 4800 }, (_, i) => i / 4800);
    const y = insertLoop(x, { start: 100, length: 200, repeats: 4, at: 1000, crossfade: 0 });
    expect(y.length).toBe(x.length);
    expect(y[1000]).toBeCloseTo(x[100], 5); expect(y[1200]).toBeCloseTo(x[100], 5); expect(y[1400]).toBeCloseTo(x[100], 5);
    expect(y[999]).toBeCloseTo(x[999], 5);
  });
  it('reverb y delay alargan la señal sin saturar', () => {
    const x = sine(440, 0.5, 0.5);
    const r = reverb(x, SR, { roomSec: 1, mix: 0.4, tailSec: 1 }), d = delay(x, SR, { timeSec: 0.25, feedback: 0.4, mix: 0.4 });
    expect(r.length).toBeGreaterThan(x.length); expect(d.length).toBeGreaterThan(x.length);
    expect(Math.max(...Array.from(r).map(Math.abs))).toBeLessThan(1.2);
  });
  it('las fuentes sintéticas son deterministas con la misma semilla', () => {
    const a = synthSource('bell', SR, 2, mulberry32(3)), b = synthSource('bell', SR, 2, mulberry32(3));
    expect(a[1000]).toBe(b[1000]);
    expect(rms(a)).toBeGreaterThan(0.01);
  });
});
