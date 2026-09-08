/**
 * Efectos de audio para construir el corpus de entrenamiento con etiquetas exactas.
 * Todo es DSP propio en TypeScript puro (sin ffmpeg): las transformaciones son las que
 * un estudiante aplicaría en un DAW, con sus artefactos típicos.
 *
 *  - time stretch: phase vocoder (STFT 2048, hop de síntesis 512, propagación de fase).
 *  - pitch shift: time stretch × remuestreo (misma duración, altura × 2^(semitonos/12)).
 *  - reversa: total o por segmentos; "reverse reverb" (reverb → invertir).
 *  - filtros: RBJ paso bajo / paso alto / paso banda, estáticos o con barrido.
 *  - loops: repetición de un segmento con o sin crossfade.
 *  - distractores (etiqueta "ausente"): reverb Schroeder, delay, ganancia, saturación, trémolo, ruido.
 */
import { fftInPlace } from '../../services/audio/dsp';

export type Rng = () => number;

/** PRNG determinista (mulberry32) para que el corpus sea reproducible. */
export const mulberry32 = (seed: number): Rng => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const hashSeed = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
export const uniform = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);

const TWO_PI = 2 * Math.PI;
const princarg = (p: number) => p - TWO_PI * Math.round(p / TWO_PI);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export const peakOf = (x: Float32Array) => { let p = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; } return p; };
export const rmsOf = (x: Float32Array) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); };

export const normalizePeak = (x: Float32Array, dbfs = -1): Float32Array => {
  const p = peakOf(x);
  const g = p > 0 ? Math.pow(10, dbfs / 20) / p : 1;
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
  return y;
};

export const gainDb = (x: Float32Array, db: number): Float32Array => { const g = Math.pow(10, db / 20); const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] * g; return y; };

/** Recorta silencio inicial (< −60 dBFS en ventanas de 10 ms) y limita la duración. */
export const trimTo = (x: Float32Array, fs: number, maxSec: number, minSec = 3): Float32Array => {
  const hop = Math.round(0.01 * fs);
  const thr = Math.pow(10, -60 / 20);
  let start = 0;
  while (start + hop < x.length && rmsOf(x.subarray(start, start + hop)) < thr) start += hop;
  const maxLen = Math.round(maxSec * fs);
  const y = x.subarray(start, Math.min(x.length, start + maxLen));
  if (y.length < minSec * fs) throw new Error(`Fuente demasiado corta tras recortar silencio: ${(y.length / fs).toFixed(1)} s`);
  // fundido de 5 ms en los extremos para no introducir clics propios del recorte
  const out = Float32Array.from(y);
  const f = Math.round(0.005 * fs);
  for (let i = 0; i < f && i < out.length; i++) { const g = i / f; out[i] *= g; out[out.length - 1 - i] *= g; }
  return out;
};

export const mixIn = (dst: Float32Array, src: Float32Array, at: number, gain = 1) => { for (let i = 0; i < src.length && at + i < dst.length; i++) dst[at + i] += src[i] * gain; };

// ---------------------------------------------------------------------------
// Phase vocoder: time stretch y pitch shift
// ---------------------------------------------------------------------------

export const timeStretch = (x: Float32Array, factor: number, N = 2048, Hs = 512): Float32Array => {
  if (factor <= 0) throw new Error('factor debe ser > 0');
  const Ha = Hs / factor; // hop de análisis (puede ser fraccionario)
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / N);
  const outLen = Math.ceil(x.length * factor) + N;
  const out = new Float64Array(outLen);
  const norm = new Float64Array(outLen);
  const re = new Float64Array(N), im = new Float64Array(N);
  const lastPhase = new Float64Array(N / 2 + 1), sumPhase = new Float64Array(N / 2 + 1);
  const frames = Math.floor((x.length - N) / Ha) + 1;
  for (let t = 0; t < frames; t++) {
    const p = Math.round(t * Ha);
    for (let i = 0; i < N; i++) { re[i] = (x[p + i] ?? 0) * win[i]; im[i] = 0; }
    fftInPlace(re, im);
    for (let k = 0; k <= N / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const phase = Math.atan2(im[k], re[k]);
      const omega = (TWO_PI * k) / N;
      const expected = omega * Ha;
      const delta = princarg(phase - lastPhase[k] - expected);
      lastPhase[k] = phase;
      const trueFreq = omega + delta / Ha;
      sumPhase[k] += trueFreq * Hs;
      re[k] = mag * Math.cos(sumPhase[k]); im[k] = mag * Math.sin(sumPhase[k]);
    }
    for (let k = 1; k < N / 2; k++) { re[N - k] = re[k]; im[N - k] = -im[k]; } // simetría hermítica
    // IFFT vía conjugación
    for (let i = 0; i < N; i++) im[i] = -im[i];
    fftInPlace(re, im);
    const o = t * Hs;
    for (let i = 0; i < N && o + i < outLen; i++) { out[o + i] += (re[i] / N) * win[i]; norm[o + i] += win[i] * win[i]; }
  }
  const y = new Float32Array(Math.round(x.length * factor));
  for (let i = 0; i < y.length; i++) y[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0;
  return y;
};

/** Remuestreo lineal: ratio > 1 acorta (reproduce más rápido). Filtra antes si decima. */
export const resampleLinear = (x: Float32Array, ratio: number, fs: number): Float32Array => {
  let src = x;
  if (ratio > 1) src = lowpass(x, fs, 0.45 * fs / ratio, 0.707);
  const n = Math.max(1, Math.round(x.length / ratio));
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos), f = pos - j;
    y[i] = (src[j] ?? 0) * (1 - f) + (src[j + 1] ?? 0) * f;
  }
  return y;
};

export const pitchShift = (x: Float32Array, fs: number, semitones: number): Float32Array => {
  const ratio = Math.pow(2, semitones / 12);
  const stretched = timeStretch(x, ratio);
  const y = resampleLinear(stretched, ratio, fs);
  // ajustar a la longitud original exacta
  const out = new Float32Array(x.length);
  out.set(y.subarray(0, Math.min(y.length, x.length)));
  return out;
};

// ---------------------------------------------------------------------------
// Reversa
// ---------------------------------------------------------------------------

export const reverseWhole = (x: Float32Array): Float32Array => Float32Array.from(x).reverse();

export const reverseSegments = (x: Float32Array, segments: { start: number; end: number }[]): Float32Array => {
  const y = Float32Array.from(x);
  for (const s of segments) {
    const a = Math.max(0, s.start), b = Math.min(x.length, s.end);
    const seg = x.subarray(a, b);
    y.set(Float32Array.from(seg).reverse(), a);
    // crossfade corto en los bordes para no fabricar cortes artificiales
    const f = Math.min(64, b - a);
    for (let i = 0; i < f; i++) { const g = i / f; y[a + i] = y[a + i] * g + x[a + i] * (1 - g); y[b - 1 - i] = y[b - 1 - i] * g + x[b - 1 - i] * (1 - g); }
  }
  return y;
};

// ---------------------------------------------------------------------------
// Filtros RBJ (Audio EQ Cookbook)
// ---------------------------------------------------------------------------

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

export const rbj = (type: FilterType, fs: number, fc: number, Q: number) => {
  const w0 = (TWO_PI * Math.min(fc, fs * 0.49)) / fs;
  const c = Math.cos(w0), s = Math.sin(w0), alpha = s / (2 * Q);
  let b0: number, b1: number, b2: number;
  if (type === 'lowpass') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
  else if (type === 'highpass') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; }
  const a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
};

/** Filtro con corte variable en el tiempo (fc(i) en Hz); coeficientes recalculados cada 32 muestras. */
export const filterVariable = (x: Float32Array, fs: number, type: FilterType, fcAt: (i: number) => number, Q: number, from = 0, to = x.length): Float32Array => {
  const y = Float32Array.from(x);
  let z1 = 0, z2 = 0;
  let c = rbj(type, fs, fcAt(from), Q);
  for (let i = from; i < to; i++) {
    if ((i - from) % 32 === 0) c = rbj(type, fs, fcAt(i), Q);
    const xi = x[i];
    const yi = c.b0 * xi + z1;
    z1 = c.b1 * xi - c.a1 * yi + z2;
    z2 = c.b2 * xi - c.a2 * yi;
    y[i] = yi;
  }
  return y;
};

export const lowpass = (x: Float32Array, fs: number, fc: number, Q = 0.707) => filterVariable(x, fs, 'lowpass', () => fc, Q);
export const highpass = (x: Float32Array, fs: number, fc: number, Q = 0.707) => filterVariable(x, fs, 'highpass', () => fc, Q);

/** Barrido logarítmico de fc entre dos frecuencias en el tramo [from, to). */
export const filterSweep = (x: Float32Array, fs: number, type: FilterType, fcStart: number, fcEnd: number, Q: number, from = 0, to = x.length) =>
  filterVariable(x, fs, type, (i) => fcStart * Math.pow(fcEnd / fcStart, Math.max(0, Math.min(1, (i - from) / Math.max(1, to - from)))), Q, from, to);

/** Filtro con modulación LFO de fc (wah / auto-filter). */
export const filterLfo = (x: Float32Array, fs: number, type: FilterType, fcCenter: number, octaves: number, rateHz: number, Q: number) =>
  filterVariable(x, fs, type, (i) => fcCenter * Math.pow(2, octaves * Math.sin((TWO_PI * rateHz * i) / fs)), Q);

// ---------------------------------------------------------------------------
// Loops
// ---------------------------------------------------------------------------

export interface LoopSpec { start: number; length: number; repeats: number; at: number; crossfade: number }

/** Inserta `repeats` copias del segmento [start, start+length) en la posición `at`; el resultado se recorta a la longitud original. */
export const insertLoop = (x: Float32Array, spec: LoopSpec): Float32Array => {
  const seg = x.subarray(spec.start, Math.min(x.length, spec.start + spec.length));
  const cf = Math.min(spec.crossfade, Math.floor(seg.length / 2));
  const stepLen = seg.length - cf;
  const loopLen = stepLen * spec.repeats + cf;
  const loop = new Float32Array(loopLen);
  for (let r = 0; r < spec.repeats; r++) {
    const o = r * stepLen;
    for (let i = 0; i < seg.length; i++) {
      let g = 1;
      if (cf > 0 && i < cf && r > 0) g = i / cf; // fade in sobre el anterior
      if (cf > 0 && i >= seg.length - cf && r < spec.repeats - 1) g = (seg.length - i) / cf; // fade out
      loop[o + i] += seg[i] * g;
    }
  }
  const y = new Float32Array(x.length);
  const at = Math.min(spec.at, x.length);
  y.set(x.subarray(0, at));
  const room = x.length - at;
  y.set(loop.subarray(0, Math.min(loopLen, room)), at);
  if (loopLen < room) y.set(x.subarray(at, at + (room - loopLen)), at + loopLen);
  return y;
};

// ---------------------------------------------------------------------------
// Distractores (no son herramientas de la rúbrica)
// ---------------------------------------------------------------------------

export const reverb = (x: Float32Array, fs: number, opts: { roomSec?: number; mix?: number; tailSec?: number } = {}): Float32Array => {
  const { roomSec = 1.5, mix = 0.35, tailSec = 1.5 } = opts;
  const n = x.length + Math.round(tailSec * fs);
  const combDelays = [0.0297, 0.0371, 0.0411, 0.0437].map((d) => Math.round(d * fs));
  const fb = Math.pow(0.001, combDelays[0] / (roomSec * fs)); // −60 dB en roomSec
  const wet = new Float64Array(n);
  for (const d of combDelays) {
    const buf = new Float64Array(d);
    let idx = 0;
    const g = Math.pow(0.001, d / (roomSec * fs));
    for (let i = 0; i < n; i++) {
      const out = buf[idx];
      buf[idx] = (x[i] ?? 0) + out * g;
      idx = (idx + 1) % d;
      wet[i] += out / combDelays.length;
    }
  }
  void fb;
  for (const d of [Math.round(0.005 * fs), Math.round(0.0017 * fs)]) {
    const buf = new Float64Array(d); let idx = 0; const g = 0.7;
    for (let i = 0; i < n; i++) { const bufout = buf[idx]; const input = wet[i]; buf[idx] = input + bufout * g; wet[i] = -input * g + bufout * (1 - g * g); idx = (idx + 1) % d; }
  }
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = (x[i] ?? 0) * (1 - mix) + wet[i] * mix;
  return y;
};

export const delay = (x: Float32Array, fs: number, opts: { timeSec?: number; feedback?: number; mix?: number } = {}): Float32Array => {
  const { timeSec = 0.375, feedback = 0.4, mix = 0.4 } = opts;
  const d = Math.round(timeSec * fs);
  const n = x.length + d * 4;
  const y = new Float32Array(n);
  const buf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dry = x[i] ?? 0;
    const echo = i >= d ? buf[i - d] : 0;
    buf[i] = dry + echo * feedback;
    y[i] = dry * (1 - mix) + echo * mix;
  }
  return y;
};

export const saturate = (x: Float32Array, driveDb = 12): Float32Array => {
  const g = Math.pow(10, driveDb / 20);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = Math.tanh(x[i] * g) / Math.tanh(g * 0.5);
  return y;
};

export const tremolo = (x: Float32Array, fs: number, rateHz = 5, depth = 0.6): Float32Array => {
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * (1 - depth * (0.5 + 0.5 * Math.sin((TWO_PI * rateHz * i) / fs)));
  return y;
};

export const addNoise = (x: Float32Array, rng: Rng, dbfs = -50): Float32Array => {
  const a = Math.pow(10, dbfs / 20) * Math.sqrt(3);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] + (rng() * 2 - 1) * a;
  return y;
};

// ---------------------------------------------------------------------------
// Fuentes sintéticas (solo para pruebas del generador; en el corpus real se marcan como tales)
// ---------------------------------------------------------------------------

export const synthSource = (kind: 'bell' | 'pluck' | 'vowel' | 'texture' | 'perc' | 'pad', fs: number, secs: number, rng: Rng): Float32Array => {
  const n = Math.round(secs * fs);
  const y = new Float32Array(n);
  const f0 = uniform(rng, 110, 440);
  if (kind === 'bell') {
    const partials = [1, 2.76, 5.4, 8.93, 13.34];
    for (let hit = 0; hit < secs / 2; hit++) {
      const at = Math.round(hit * 2 * fs + rng() * 0.3 * fs);
      partials.forEach((r, k) => { const dec = 1.2 / (k + 1); for (let i = 0; i < 2.5 * fs && at + i < n; i++) y[at + i] += (0.4 / (k + 1)) * Math.sin(TWO_PI * f0 * r * i / fs) * Math.exp(-i / (dec * fs)); });
    }
  } else if (kind === 'pluck') {
    for (let note = 0; note < secs * 2; note++) {
      const at = Math.round(note * 0.5 * fs), f = f0 * Math.pow(2, pick(rng, [0, 2, 3, 5, 7, 10]) / 12);
      const N = Math.round(fs / f); const buf = new Float32Array(N); for (let i = 0; i < N; i++) buf[i] = rng() * 2 - 1;
      let idx = 0; for (let i = 0; i < 1.2 * fs && at + i < n; i++) { const next = (idx + 1) % N; const v = 0.5 * (buf[idx] + buf[next]) * 0.996; buf[idx] = v; y[at + i] += v * 0.6; idx = next; }
    }
  } else if (kind === 'vowel') {
    const formants = pick(rng, [[730, 1090, 2440], [270, 2290, 3010], [530, 1840, 2480], [570, 840, 2410]]);
    for (let i = 0; i < n; i++) {
      const vib = 1 + 0.01 * Math.sin(TWO_PI * 5.5 * i / fs);
      const f = f0 * vib * (1 + 0.15 * Math.sin(TWO_PI * 0.2 * i / fs));
      let s = 0; for (let h = 1; h <= 30; h++) { const fh = f * h; let g = 0; for (const F of formants) g += 1 / (1 + Math.pow((fh - F) / 120, 2)); s += g * Math.sin(TWO_PI * fh * i / fs) / h; }
      y[i] = s * 0.15 * (0.7 + 0.3 * Math.sin(TWO_PI * 0.5 * i / fs));
    }
  } else if (kind === 'texture') {
    let lp = 0; const cut = uniform(rng, 0.02, 0.2);
    for (let i = 0; i < n; i++) { lp += cut * ((rng() * 2 - 1) - lp); y[i] = lp * 2 * (0.6 + 0.4 * Math.sin(TWO_PI * 0.13 * i / fs)); }
  } else if (kind === 'perc') {
    const step = Math.round(0.25 * fs);
    for (let k = 0; k * step < n; k++) {
      if (rng() < 0.3) continue;
      const at = k * step, tone = k % 4 === 0 ? 60 : k % 2 === 0 ? 180 : 0, decay = k % 4 === 0 ? 0.25 : 0.08;
      for (let i = 0; i < 0.4 * fs && at + i < n; i++) y[at + i] += (tone ? Math.sin(TWO_PI * tone * i / fs * (1 + 2 * Math.exp(-i / (0.02 * fs)))) : (rng() * 2 - 1)) * 0.8 * Math.exp(-i / (decay * fs));
    }
  } else {
    const chord = [0, 4, 7, 11].map((s) => f0 * Math.pow(2, s / 12));
    for (let i = 0; i < n; i++) { let s = 0; for (const f of chord) s += Math.sin(TWO_PI * f * i / fs) + 0.5 * Math.sin(TWO_PI * f * 1.003 * i / fs); y[i] = s * 0.08 * (0.5 - 0.5 * Math.cos(TWO_PI * i / n)); }
  }
  return normalizePeak(y, -3);
};

/** Remuestreo a otra frecuencia (filtro paso bajo previo si decima). Para extractos de escucha, no para medir. */
export const resampleMonoLinear = (x: Float32Array, fromRate: number, toRate: number): Float32Array => {
  const ratio = fromRate / toRate;
  const src = ratio > 1 ? lowpass(x, fromRate, 0.45 * toRate, 0.707) : x;
  const n = Math.max(1, Math.round(x.length / ratio));
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const pos = i * ratio; const j = Math.floor(pos), f = pos - j; y[i] = (src[j] ?? 0) * (1 - f) + (src[j + 1] ?? 0) * f; }
  return y;
};
